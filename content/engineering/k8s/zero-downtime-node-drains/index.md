---
title: Zero-downtime node drains
date: 2026-11-04
draft: false
description: "Why replacing a node can cause 5xx errors, and the small set of settings that prevent it: PDBs, spread, preStop, grace period, readiness gates"
categories: ["k8s"]
tags: ["reliability", "pdb", "load-balancing"]
---
Nodes get replaced all the time: kernel patches, AMI updates, autoscaler consolidation. Replacing a node means **draining** it: every pod on it is evicted and started somewhere else. Done carelessly, users see `502`/`503`. These are the few pieces that make a drain invisible.

---

## 1. The race behind most errors

When a pod is evicted, two things start **at the same time**:

```
pod marked Terminating
   ├─► A: remove it from traffic
   │      EndpointSlice → kube-proxy on every node      ~1–2 s
   │      EndpointSlice → load-balancer controller → LB deregisters the pod IP   ~5–20 s
   └─► B: shut it down
          preStop hook → SIGTERM → (grace period runs out) → SIGKILL
```

If **B finishes before A**, the load balancer still sends requests to a process that is gone, and you get `502`. If *every* replica goes at once, there's nothing to send to, and you get `503`.

| Error | Usually means                                          | Fix                                    |
| ----- | ------------------------------------------------------ | -------------------------------------- |
| 502   | Connection reset: the pod died with requests in flight | preStop delay + graceful SIGTERM       |
| 503   | No healthy targets left                                | ≥2 replicas + PDB + readiness gates    |
| 504   | A slow request outlived the grace period               | Longer `terminationGracePeriodSeconds` |

---

## 2. PodDisruptionBudget (PDB)

A PDB says: **"of these pods, never voluntarily take down more than N at once."**

### How it works
- `kubectl drain`, cluster autoscalers and managed node upgrades evict pods through the **Eviction API**. They don't delete pods directly.
- Before each eviction, the API server checks the PDB. If evicting this pod would break the budget, it answers **429: try again later**, and the drain waits and retries.
- As soon as a replacement pod becomes **Ready**, the budget frees up and the next eviction goes through.

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
- **Deployment rollouts:** those follow the Deployment's own `maxSurge`/`maxUnavailable`.
- **Single-replica apps:** no budget can keep 1 pod up while moving it.

### Getting started
1. Find the zero-budget PDBs: `kubectl get pdb -A` and look for `ALLOWED DISRUPTIONS = 0`.
2. Every Deployment that serves traffic gets **≥2 replicas** and `maxUnavailable: 1` (or `25%` for big ones).
3. Stateful quorum systems (etcd, ZooKeeper, Keeper): `maxUnavailable: 1`.
4. Batch Jobs: usually no PDB; the Job controller re-runs the pod.

---

## 3. Spread replicas across nodes

A PDB lets only one replica go *at a time*. But if both replicas sit on the **same node**, a node failure still takes out both. Spread them:

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname      # or topology.kubernetes.io/zone
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels: { app: web }
```

---

## 4. preStop: wait for traffic to stop first

This fixes the race in §1. Before SIGTERM, keep serving while the load balancer catches up:

```yaml
lifecycle:
  preStop:
    sleep:
      seconds: 20      # built-in since k8s 1.30 (stable in 1.34); no shell needed
```

The order is guaranteed: **preStop finishes first, then SIGTERM is sent.**

---

## 5. terminationGracePeriodSeconds: the total budget

The countdown starts **before** preStop, and it includes it:

```
|←────────── terminationGracePeriodSeconds ──────────→|
| preStop (20 s) | SIGTERM → app finishes in-flight work | SIGKILL
```

Rule: **grace ≥ preStop + the longest request.** The default of 30 s leaves only 10 s after a 20 s preStop, which isn't enough for slow APIs or streams.

---

## 6. The app must handle SIGTERM

On SIGTERM, the app should:
1. stop accepting **new** connections;
2. finish the requests it already has;
3. close idle keep-alive connections;
4. exit.

Most servers do this when configured: gunicorn `graceful_timeout`, uvicorn, Go `http.Server.Shutdown`, nginx `quit`. Also keep the app's **keep-alive idle timeout longer than the load balancer's**. Otherwise the app closes a connection at the exact moment the LB reuses it, and you get a random 502.

---

## 7. Load-balancer readiness gates

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

## 8. Checklist

| # | Item | Prevents |
|---|---|---|
| 1 | ≥2 replicas | 503: nothing left to serve |
| 2 | PDB `maxUnavailable: 1` (never 0 allowed) | 503: all replicas evicted at once; and stuck drains |
| 3 | Topology spread | Losing all replicas with one node |
| 4 | `preStop` sleep ~20 s | 502: the shutdown-vs-deregistration race |
| 5 | Grace ≥ preStop + longest request | 504 and SIGKILL mid-request |
| 6 | Graceful SIGTERM + keep-alive > LB idle | 502: resets and keep-alive races |
| 7 | LB readiness gates | 503: "Ready" before the LB is actually sending traffic |

**Prove it:** run steady load through the load balancer, drain a node, and count non-2xx responses. Do it once before the changes and once after. The goal is zero.
