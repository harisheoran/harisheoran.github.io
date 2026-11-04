---
title: Zero-downtime node drains
date: 2026-11-04
draft: false
description: "Why replacing a node can cause 5xx errors, and the small set of settings that prevent it: the shutdown timers, PDBs, spread, readiness gates"
categories: ["k8s"]
tags: ["reliability", "pdb", "load-balancing"]
---
Nodes get replaced all the time: kernel patches, AMI updates, autoscaler consolidation. Replacing a node means **draining** it: every pod on it is evicted and started somewhere else. Done carelessly, users see `502`/`503`. These are the few pieces that make a drain invisible.

---

## 1. Shutting down one pod: the race and the three timers

When a pod is evicted, two things start **at the same time**:

- **Track A, stop the traffic:** the pod is removed from the Service endpoints. kube-proxy updates in ~1–2 s. The load balancer deregisters the pod IP in ~5–20 s.
- **Track B, stop the process:** the kubelet starts shutting the container down.

If B finishes before A, the load balancer still sends requests to a dead process, and you get `502`. Three timers control track B. **They're one sequence, so set them together:**

```
t=0  pod evicted ─────────────────────────────────────────────────────────────►
     │
     │◄──────────── terminationGracePeriodSeconds (pod spec, total budget) ───────────►│
     │                                                                                 │
     │◄─ preStop sleep ─►│◄────── app graceful timeout ──────►│                        │
     │   (pod spec)      │       (inside the app: gunicorn     │                        │
     │                   │        graceful_timeout, Go         │                        │
     │                   │        Shutdown(ctx), ...)          │                        │
     │  still serving,   │ SIGTERM: stop accepting new conns,  │ app exits    ...or     │ SIGKILL
     │  LB draining us   │ finish in-flight requests           │ (clean)               │ (hard)
     │                   │                                     │                        │
Track A: ── LB/kube-proxy stop sending new requests ──►│ done by here (~20 s)
```

| Timer | Where it lives | What it does | Typical value |
|---|---|---|---|
| `preStop` sleep | pod spec, `lifecycle.preStop.sleep.seconds` | Keeps serving while track A finishes. SIGTERM is only sent **after** preStop ends | 15–20 s |
| App graceful timeout | the app server's own setting | After SIGTERM: how long the app waits for in-flight requests before it kills them itself | ≥ your longest request |
| `terminationGracePeriodSeconds` | pod spec | **Total** budget, counted **from t=0, including preStop**. When it runs out: SIGKILL | preStop + app timeout + ~10 s buffer |

**The rule:** `terminationGracePeriodSeconds ≥ preStop + app graceful timeout + buffer`

```yaml
spec:
  terminationGracePeriodSeconds: 60      # 20 + 30 + 10 buffer
  containers:
    - name: web
      lifecycle:
        preStop:
          sleep:
            seconds: 20                  # built-in since k8s 1.30 (stable 1.34)
      # app side: e.g. gunicorn --graceful-timeout 30
```

What goes wrong when they don't line up:

| Mistake | Result |
|---|---|
| No preStop | SIGTERM arrives while the LB still sends traffic → **502** |
| App graceful timeout < longest request | The app kills its own slow requests → **502** |
| Grace period < preStop + app timeout | The kubelet SIGKILLs mid-request → **502/504** |
| Grace period still at the 30 s default with a 20 s preStop | The app gets only 10 s to drain |

Two more app-side details:
- The app's **keep-alive idle timeout should be longer than the load balancer's**. Otherwise the app closes an idle connection at the exact moment the LB reuses it, and you get a random 502.
- On SIGTERM, close idle keep-alive connections, so clients reconnect elsewhere.

---

## 2. PodDisruptionBudget (PDB): how many pods may be down at once

Section 1 makes **one** pod's shutdown clean. A PDB makes sure that **not too many** pods of the same app shut down together.

### How it works
- Node drains, autoscalers and managed node upgrades **evict** pods through the **Eviction API**. They don't delete them directly.
- Before each eviction, the API server checks the PDB. If evicting the pod would break the budget, it answers **429: try again later**, and the drain retries.
- When a replacement pod becomes **Ready**, the budget frees up and the next eviction goes through.

```
3 replicas, maxUnavailable: 1

evict pod-a ✅  (2 ready)      → pod-a' starting...
evict pod-b ❌  429, wait       → pod-a' Ready (3 ready)
evict pod-b ✅                  → ...one at a time
```

`kubectl get pdb` shows the live answer in the **ALLOWED DISRUPTIONS** column.

### The settings
```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web
spec:
  maxUnavailable: 1          # OR minAvailable, never both
  selector:
    matchLabels:
      app: web
  unhealthyPodEvictionPolicy: AlwaysAllow   # optional, see below
```

| Field | Meaning | Notes |
|---|---|---|
| `minAvailable` | At least this many must stay Ready | A number or `"%"`. Percentages **round up** |
| `maxUnavailable` | At most this many may be down | A number or `"%"`. Percentages **round up** too. It **scales with replicas**, so it's usually the better choice |
| `selector` | Which pods it guards | Must match the Deployment's pod labels |
| `unhealthyPodEvictionPolicy` | Can pods that are *already* not Ready be evicted? | `IfHealthyBudget` (default): only if the budget allows. `AlwaysAllow`: yes, always. This stops a crash-looping pod from blocking a drain forever |

### The trap: budgets that allow zero
| Config | Replicas | Allowed disruptions | Result |
|---|---|---|---|
| `minAvailable: 1` | 1 | 0 | The drain is **blocked forever** |
| `minAvailable: 70%` | 2 | 0 (70% of 2 rounds up to 2) | Blocked forever |
| `maxUnavailable: 0` | any | 0 | Blocked forever, on purpose |
| `maxUnavailable: 1` | ≥2 | 1 | ✅ rolls one at a time |

A blocked drain doesn't fail safely. The upgrade times out, or a hard deadline force-kills the pods anyway. **A PDB must always allow at least 1.**

### What a PDB does *not* cover
- **Involuntary loss:** a node crash or kernel panic ignores PDBs.
- `kubectl delete pod`: that's a delete, not an eviction.
- **Deployment rollouts:** those use the Deployment's own settings (see §3).
- **Single-replica apps:** no budget can keep 1 pod up while moving it.

### Getting started
1. Find the zero-budget PDBs: `kubectl get pdb -A` and look for `ALLOWED DISRUPTIONS = 0`.
2. Every Deployment that serves traffic gets **≥2 replicas** and `maxUnavailable: 1` (or `25%` for big ones).
3. Stateful quorum systems (etcd, ZooKeeper, Keeper): `maxUnavailable: 1`.
4. Batch Jobs: usually no PDB; the Job controller re-runs the pod.

---

## 3. A Deployment's own `maxUnavailable`, and how it differs from the PDB's

A Deployment has its **own** `maxUnavailable`, but it controls something different:

```yaml
kind: Deployment
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%          # default: extra NEW pods allowed above replicas (rounds up)
      maxUnavailable: 25%    # default: OLD pods that may be down below replicas (rounds down)
```

| | Deployment `maxUnavailable` | PDB `maxUnavailable` |
|---|---|---|
| Guards against | **Your own rollout**: a new image or config | **Evictions**: node drain, upgrade, autoscaler |
| Who enforces it | The Deployment controller, as it replaces pods | The API server, on each eviction request |
| Mechanism | Creates new pods (surge) and removes old ones step by step | Answers 429 to the eviction until it's safe |
| Is the other one consulted? | No, rollouts ignore PDBs | No, drains ignore the Deployment strategy |

They don't know about each other, so you need **both**:
- the Deployment strategy makes `kubectl set image` safe;
- the PDB makes a node drain safe.

A common safe rollout setting is `maxSurge: 1, maxUnavailable: 0`: start a new pod, wait for Ready, then remove an old one.

---

## 4. Spread replicas across nodes: how the scheduler does it

A PDB limits **how many** pods go at once. It doesn't control **where** they run. If both replicas sit on the same node, then:
- that node dying takes out both (a PDB can't help with a crash);
- during a drain, the second pod's eviction waits, so the drain gets slow.

### Without any rule
The scheduler applies built-in **soft** defaults: per node `maxSkew: 3`, per zone `maxSkew: 5`, both `ScheduleAnyway`. So **2 replicas landing on the same node is perfectly "fine"** by default.

### With `topologySpreadConstraints`
```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname       # the "domain" = one node
    whenUnsatisfiable: DoNotSchedule          # hard rule (or ScheduleAnyway = preference)
    labelSelector:
      matchLabels: { app: web }               # must match the pod's own labels
```

**How it decides, for each new pod:**
1. Group the nodes into **domains** by `topologyKey`: each node (hostname), or each zone.
2. Count the pods matching `labelSelector` in each domain.
3. **skew = count in the chosen domain (after placing) − the lowest count of any domain.**
4. Only domains where the skew stays **≤ maxSkew** are allowed.

```
replicas: 4, maxSkew: 1, per node

pod 1:  node-a [1]  node-b [0]  node-c [0]
pod 2:  node-a [1]  node-b [1]  node-c [0]     node-a would be 2−0 = 2 > 1 ✗
pod 3:  node-a [1]  node-b [1]  node-c [1]
pod 4:  node-a [2]  node-b [1]  node-c [1]     2−1 = 1 ✓ (any node is fine now)
```

| Option | Meaning |
|---|---|
| `whenUnsatisfiable: DoNotSchedule` | Hard. The pod stays `Pending` rather than break the spread. A node autoscaler then adds a node |
| `whenUnsatisfiable: ScheduleAnyway` | Soft. It prefers balanced nodes, but will stack if it must |
| `topologyKey: topology.kubernetes.io/zone` | Spread across AZs instead of nodes. You can use **both** keys |
| `minDomains` | "Assume at least N domains exist". This forces spreading even when fewer nodes exist yet |

**Things to know:**
- It's checked **only when a pod is scheduled**. It never moves running pods. After a scale-down or a node roll, the layout can become unbalanced until pods are recreated (or a Descheduler runs).
- The `labelSelector` must match the pod's own labels. Otherwise the pod doesn't count itself, and the pods silently pile up.
- An alternative is `podAntiAffinity` ("never two `app=web` on one node"). It's stricter: with more replicas than nodes, the extra pods can't schedule.

---

## 5. Load-balancer readiness gates

"Ready" in Kubernetes means *the probe passed*. It does **not** mean *the load balancer is sending traffic here yet*. During a drain, a new pod can be Ready, so the PDB frees up and the old pod is evicted, while the LB is still registering the new one. The target group then has no healthy targets, and you get a 503.

The **AWS Load Balancer Controller** fixes this. Label the namespace:

```bash
kubectl label namespace web elbv2.k8s.aws/pod-readiness-gate-inject=enabled
```

New pods then get an extra readiness condition (`target-health.elbv2.k8s.aws/...`). They only count as Ready once the ALB health check passes, so the PDB waits for **real** traffic readiness.

Caveats:
- This only works with `target-type: ip`.
- It's injected **at pod creation**, so existing pods need a restart to get it.

---

## 6. Checklist

| # | Item | Prevents |
|---|---|---|
| 1 | preStop + app graceful timeout + grace period, set together (§1) | 502/504 when a pod stops |
| 2 | ≥2 replicas | 503: nothing left to serve |
| 3 | PDB `maxUnavailable: 1` (never 0 allowed) | 503: too many evicted at once; and stuck drains |
| 4 | Deployment `maxSurge: 1, maxUnavailable: 0` | 503 during your own rollouts |
| 5 | Topology spread (node and zone) | Losing all replicas with one node |
| 6 | Keep-alive idle > LB idle | Random 502s |
| 7 | LB readiness gates | 503: "Ready" before the LB is actually sending traffic |

**Prove it:** run steady load through the load balancer, drain a node, and count non-2xx responses. Do it once before the changes and once after. The goal is zero.
