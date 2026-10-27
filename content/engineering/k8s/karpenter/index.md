---
title: Karpenter
date: 2026-10-27
draft: false
description: "Node autoscaling from first principles: what it solves, how it decides, every knob, and how to run it safely"
categories: ["k8s"]
tags: ["scaling", "aws", "cost"]
---
Karpenter adds and removes **nodes** in a Kubernetes cluster. It watches for pods that can't be scheduled, buys the right EC2 instance for them, and later takes that instance away again when the pods don't need it any more. That second half, taking nodes away, is where the cost savings come from, and it's also where all the risk sits.

This note is written against **Karpenter v1.15.1 (October 2026)**, the latest release. The AWS provider is the reference throughout, because that's where Karpenter is most mature.

---

## 1. The problem: what Kubernetes gives you without Karpenter

Kubernetes schedules pods onto nodes. It never creates nodes. If no node has room, the pod sits in `Pending` forever:

```
Events:
  Warning  FailedScheduling  0/6 nodes are available: 6 Insufficient cpu.
```

Something outside the scheduler has to notice this and buy a machine. Before Karpenter, that was the **Cluster Autoscaler (CAS)** driving **node groups** (on AWS, Auto Scaling Groups):

```
pending pod ──► Cluster Autoscaler ──► "which node group could fit it?"
                                          │
                                          ▼
                                  ASG desired += 1
                                          │
                                          ▼
                       ASG launches its ONE configured instance type
```

That model has four weaknesses.

**Weakness 1: the node group decides the shape, not the pod.**  
Each ASG has one launch template, usually one instance type or a small, same-size family. If a pod needs 30 GiB of memory and your groups are `m5.xlarge` (16 GiB), nothing fits. You end up creating a node group per shape: `general`, `memory`, `gpu`, `arm`, `spot-general`, `spot-memory`… and CAS has to simulate each one.

**Weakness 2: bad bin-packing means paying for air.**  
CAS adds one more node of a fixed size. A 0.5-vCPU pod can trigger a whole 8-vCPU node. Scale-down only removes a node when it's below a utilization threshold *and* its pods fit elsewhere. Nothing ever says "these three half-empty nodes should be one smaller node".

**Weakness 3: two layers of autoscaling that don't agree.**  
CAS speaks Kubernetes, the ASG speaks AWS. The ASG can rebalance AZs on its own, terminate a node CAS didn't choose, or fail to launch a type without CAS knowing why. Zone-aware scheduling (an EBS volume in one AZ) needs one node group per AZ.

**Weakness 4: spot is painful.**  
Spot is cheapest when you're flexible across many instance types and AZs. ASGs can do mixed instances, but CAS assumes every node in a group is identical, so mixing sizes breaks its simulation.

**Karpenter's answer:** delete the node-group layer. Karpenter reads the pending pods directly, works out the cheapest instance that fits them **right now**, and calls the EC2 Fleet API itself. There's no ASG and no fixed instance type. **Then it keeps re-checking: "if I started from scratch, would I build this cluster the same way?" When the answer is no, it replaces nodes.**

```
                  ┌──────── Karpenter ────────┐
pending pods ───► │ batch → simulate → choose │ ───► EC2 CreateFleet (60 candidate types)
                  └───────────────────────────┘
                              ▲
running nodes ────────────────┘   "is there a cheaper arrangement?" → consolidate
```

---

## 2. Mental model: two loops

Everything Karpenter does belongs to one of two loops. Keep them apart in your head, because they have different safety controls.

|                | **Provisioning** (scale up)                              | **Disruption** (scale down / replace)                                                    |
| -------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Trigger        | pods the kube-scheduler marked unschedulable             | timers and a continuous cost/health/drift check                                          |
| Question       | "what's the cheapest set of nodes that fits these pods?" | "can I remove or replace a node without breaking anything?"                              |
| Risk           | over-spending, launching the wrong shape                 | evicting pods, i.e. causing an outage                                                    |
| Guarded by     | NodePool `limits`, requirements, weights                 | disruption budgets, PDBs, `do-not-disrupt`, `consolidateAfter`, `terminationGracePeriod` |
| Saves money by | right-sizing new nodes                                   | removing waste after the fact (this is the big one)                                      |


---

## 3. The components

```
┌─────────────────────────────── your cluster ────────────────────────────────┐
│                                                                             │
│  ┌──────── karpenter controller (Deployment, 2 replicas, leader-elected) ─┐ │
│  │  provisioner · disruption controller · termination controller          │ │
│  │  interruption controller · nodeclass controller · (node repair)        │ │
│  └──────────────┬───────────────────────────────────┬─────────────────────┘ │
│                 │ reads/writes                      │ watches                │
│        ┌────────▼─────────┐                ┌────────▼────────┐               │
│        │ NodePool (CRD)   │──nodeClassRef─►│ EC2NodeClass    │               │
│        │ "what & when"    │                │ "how on AWS"    │               │
│        └────────┬─────────┘                └─────────────────┘               │
│                 │ creates                                                    │
│        ┌────────▼─────────┐  1:1   ┌──────────┐   1:1   ┌────────────────┐   │
│        │ NodeClaim (CRD)  │◄──────►│   Node   │◄───────►│ EC2 instance   │   │
│        └──────────────────┘        └──────────┘         └────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
        │                           ▲
        │ EC2 Fleet / IAM / SSM /   │ EventBridge → SQS
        ▼ Pricing APIs              │ (spot interruption, health, state change)
     AWS account ───────────────────┘
```

### 3.1 The controller

A single Go binary, deployed with Helm (`oci://public.ecr.aws/karpenter/karpenter`). The chart defaults to `replicas: 2` with leader election (only one is active), a PDB of `maxUnavailable: 1`, and `priorityClassName: system-cluster-critical`.

**Rule:** never run the controller on a node Karpenter manages. If it consolidates its own node, nobody is left to launch the replacement. Run it on a small managed node group (2 nodes across 2 AZs) or on Fargate.

It needs two IAM roles:

- **Controller role** (IRSA or EKS Pod Identity): EC2 Fleet/RunInstances, launch templates, describe calls, `iam:PassRole` for the node role, instance-profile management, SSM read (AMI lookups), Pricing API, SQS read/delete. Since v1.9 the reference CloudFormation splits this into five policies (NodeLifecycle, IAMIntegration, EKSIntegration, InterruptionPolicy, ResourceDiscovery), plus ZonalShift if you use it.
- **Node role**: what the EC2 instances run as (the usual `AmazonEKSWorkerNodePolicy`, CNI, ECR read, SSM). The cluster must also let it join, through an EKS access entry of type `EC2_LINUX` (or the legacy `aws-auth` ConfigMap).

### 3.2 NodePool: "what kind of nodes, and when they may go"

A NodePool is a **policy**, not a group of machines. It says:

- which instances are **allowed** (requirements: arch, capacity type, family, size, zone…)
- what every node gets (labels, taints)
- the most it may ever buy (`limits`)
- how and when nodes may be taken away (`disruption`, `expireAfter`, `terminationGracePeriod`)
- which pool wins when several match (`weight`)

### 3.3 EC2NodeClass: "how to build the machine on AWS"

The AWS-specific half: AMI, subnets, security groups, IAM role, disks, kubelet settings, IMDS, user data and tags. Several NodePools can share one NodeClass.

### 3.4 NodeClaim: "one requested machine"

Karpenter creates one NodeClaim per instance it launches. A NodeClaim maps 1:1 to an EC2 instance (`status.providerID`) and a Kubernetes Node (`status.nodeName`). **NodeClaims are immutable.** You never edit one. You change the NodePool or NodeClass, and the difference shows up as **drift** (section 6.3).

Lifecycle:

```
Launched ──► Registered ──► Initialized ──► Ready
   │             │               │
   │             │               └─ node Ready, startupTaints removed, extended resources (GPU) present
   │             └─ kubelet joined, Karpenter synced labels/taints, removed karpenter.sh/unregistered taint
   └─ EC2 instance exists
                 ✗ not registered within 15 min → NodeClaim deleted, instance terminated, retried
```

During disruption you'll also see `Consolidatable`, `Drifted`, `Drained`, `VolumesDetached` and `InstanceTerminating`.

```bash
kubectl get nodepools
kubectl get ec2nodeclasses
kubectl get nodeclaims -o wide           # type, zone, capacity, node, age, ready
kubectl describe nodeclaim <name>        # conditions + events: start here when debugging
```

### 3.5 The interruption queue (AWS side)

An SQS queue that EventBridge rules feed. The reference template has five rules:

| EventBridge `detail-type`                                | What Karpenter does                                     |
| -------------------------------------------------------- | ------------------------------------------------------- |
| `EC2 Spot Instance Interruption Warning`                 | 2-minute notice → taint, start a replacement, drain now |
| `AWS Health Event` (scheduled change)                    | drain and replace ahead of the maintenance              |
| `EC2 Instance State-change Notification`                 | instance stopping/terminating → clean up                |
| `EC2 Instance Rebalance Recommendation`                  | **event only**, no drain                                |
| `EC2 Capacity Reservation Instance Interruption Warning` | interruptible ODCR reclaim (v1.10+)                     |

Set it with `settings.interruptionQueue`. **Without it, a spot reclaim is a hard power-off**: pods die without draining and you only find out when the node goes `NotReady`. Treat it as required whenever spot is in use, and useful even without spot.

### 3.6 Optional / newer CRDs

| CRD | Purpose | Stage (v1.15) |
|---|---|---|
| `CapacityBuffer` (`autoscaling.x-k8s.io`) | keep spare headroom so pods schedule instantly (section 10.3) | gate `CapacityBuffer`, alpha, off; API served as `v1beta1` since v1.14 |
| `NodeOverlay` (`karpenter.sh/v1alpha1`) | adjust the price or extended resources Karpenter *thinks* an instance has | gate `NodeOverlay`, alpha, off |

---

## 4. Provisioning, step by step

### 4.1 From pending pod to running node

```
t=0s     kube-scheduler marks pod Unschedulable
t=0–10s  Karpenter BATCHES: waits until no new pending pod for 1s (batchIdleDuration),
         but never longer than 10s total (batchMaxDuration)
         → 40 pods from one Deployment scale-up become ONE decision, not 40
t≈10s    SIMULATE: for the batch, try to fit pods onto
           (a) existing nodes and in-flight NodeClaims, then
           (b) new NodeClaims from each matching NodePool (highest weight first)
         Respect every pod constraint: requests, nodeSelector, affinity, anti-affinity,
         topology spread, tolerations, PVC zones, DaemonSet overhead
t≈10s    CHOOSE: for each new NodeClaim, list instance types that fit, cheapest first;
         send up to 60 to EC2 CreateFleet
           spot      → price-capacity-optimized (cheap AND deep pools, lower interruption)
           on-demand → lowest-price
           reserved  → your ODCRs / capacity blocks first (if configured)
t≈15–60s EC2 instance boots, kubelet registers
t≈40–90s node Ready, kube-scheduler binds the pods (Karpenter nominates; it does NOT bind)
```

### 4.2 Karpenter reads requests and ignores limits

Instance choice uses **`resources.requests` only**. This is the most important fact about Karpenter's economics:

| Your pods | Effect |
|---|---|
| request 2 CPU, use 0.2 | Karpenter buys ~10× the CPU you use. Consolidation can't fix it, because on paper the node is full. |
| request 0.1 CPU, use 2 | Dense packing, then CPU throttling and noisy neighbours. |
| memory request < limit | Consolidation packs by requests, so several pods bursting together OOM the node. |
| no requests at all | Karpenter treats the pod as ~free. It packs onto anything, and nodes get overloaded. |

So **right-sizing requests is the first cost lever, ahead of anything in Karpenter**. Set memory `requests == limits` for anything that matters, and use a `LimitRange` per namespace so that pods without requests still get one.

### 4.3 DaemonSet overhead

When sizing a new node, Karpenter adds the requests of every DaemonSet that would land on it. With heavy DaemonSets (log shippers, security agents, CNI, node exporter) on small instances, that overhead can be 30–50% of the node. That's a reason to allow larger instance sizes.

### 4.4 Constraints are layered

```
cloud provider  : every instance type, arch, zone, capacity type that exists
   ∩
NodePool        : requirements (e.g. arch=amd64, category in c/m/r, capacity in spot/on-demand)
   ∩
Pod             : nodeSelector / required nodeAffinity / tolerations / PVC zone
   =
what Karpenter may launch for that pod  (empty set ⇒ pod stays Pending, and the event says why)
```

- A **preferred** affinity or `ScheduleAnyway` spread is first treated as **required**, then relaxed one term at a time if it can't be met (`settings.preferencePolicy: Respect`, the default; `Ignore` skips them). Side effect: preferences can make Karpenter launch *more* nodes than you'd expect, and they can **block consolidation** (section 6.2).
- Topology spread keys Karpenter understands: `topology.kubernetes.io/zone`, `kubernetes.io/hostname`, `karpenter.sh/capacity-type`. A NodePool doesn't balance zones by itself. **Pods need a zonal spread constraint to get zone balance.**
- PVCs: Karpenter follows PVC → StorageClass → volume zone, so a pod with an existing EBS volume gets a node in that volume's AZ.
- Custom labels a pod selects on must be declared in the NodePool (in `template.metadata.labels`, or a requirement with `Exists`), or the pod stays Pending.

### 4.5 Multiple NodePools: make them exclusive or weighted

If two pools both match a pod and have the same weight, Karpenter picks one **at random**. Design pools so that either:

- **they're mutually exclusive** (a taint on the GPU pool, a label the pod must select), or
- **they're weighted**: a higher `weight` is tried first, and Karpenter falls back to lower weights when the higher one can't satisfy the pod or has hit its `limits`.

Classic weighted pattern: a reserved / Savings-Plan-covered pool (weight 100, `limits.cpu` = what you've committed to) → a general pool (weight 10) → an on-demand fallback (weight 0).

### 4.6 When EC2 says no (ICE)

`InsufficientInstanceCapacity` for a type, zone and capacity-type combination marks that **offering** unavailable for a few minutes, across all NodePools. Karpenter retries with the remaining offerings. If a pool allows only spot and every spot offering fails, pods stay Pending, because Karpenter never falls back to a capacity type the pool doesn't allow. **Allow on-demand alongside spot** unless you've chosen to accept that.

---

## 5. NodePool: every field that matters

```yaml
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: general
spec:
  weight: 10                                  # default 0; higher is tried first
  limits:                                     # cap on the pool's TOTAL capacity (eventually consistent)
    cpu: "400"
    memory: 1600Gi
  template:
    metadata:
      labels: { workload-class: general }     # copied onto every node
    spec:
      nodeClassRef:                           # group + kind are required in v1
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: default
      requirements:
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64", "arm64"]           # allowing Graviton widens the price pool
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["spot", "on-demand"]        # preference order: reserved > spot > on-demand
        - key: karpenter.k8s.aws/instance-category
          operator: In
          values: ["c", "m", "r"]
        - key: karpenter.k8s.aws/instance-generation
          operator: Gt
          values: ["5"]
        - key: karpenter.k8s.aws/instance-cpu
          operator: Lt
          values: ["65"]                       # avoid huge blast-radius nodes
        - key: karpenter.k8s.aws/instance-family
          operator: Exists
          minValues: 5                         # insist on ≥5 families per launch (spot resilience)
      taints: []                               # pods must tolerate these
      startupTaints: []                        # removed by another agent at boot (e.g. CNI readiness)
      expireAfter: 720h                        # max node lifetime; default 720h; "Never" disables
      terminationGracePeriod: 24h              # max drain time; unset = can wait forever
  disruption:
    consolidationPolicy: WhenEmptyOrUnderutilized   # default; or Balanced / WhenEmpty
    consolidateAfter: 5m                            # default 0s; "Never" disables consolidation
    budgets:
      - nodes: "10%"                                # default if you set no budgets at all
```

### 5.1 Requirements

Operators: `In`, `NotIn`, `Exists`, `DoesNotExist`, `Gt`, `Lt`, `Gte`, `Lte`. An empty list `requirements: []` means "anything the provider sells". The NodePool and NodeClaim together are limited to 100 requirements plus labels.

Useful well-known keys:

| Key | Example values |
|---|---|
| `karpenter.sh/capacity-type` | `spot`, `on-demand`, `reserved` (ODCRs and capacity blocks, **not** RIs or Savings Plans) |
| `kubernetes.io/arch` | `amd64`, `arm64` |
| `topology.kubernetes.io/zone` | AZ names (they map to different physical AZs in different accounts) |
| `node.kubernetes.io/instance-type` | `m7i.xlarge` (prefer broad keys over pinning types) |
| `karpenter.k8s.aws/instance-category` | `c`, `m`, `r`, `t`, `g`, `p`… |
| `karpenter.k8s.aws/instance-family` | `m7i`, `c7g` |
| `karpenter.k8s.aws/instance-generation` | `6`, `7` (use `Gt`) |
| `karpenter.k8s.aws/instance-size` | `large`, `2xlarge` |
| `karpenter.k8s.aws/instance-cpu`, `instance-memory` | numeric, for `Gt`/`Lt` |
| `karpenter.k8s.aws/instance-hypervisor` | `nitro` |
| `karpenter.k8s.aws/instance-gpu-*`, `instance-local-nvme`, `instance-network-bandwidth` | hardware selection |

**`minValues`** forces diversity: "every launch decision must consider at least N distinct values of this key". It protects spot from being concentrated in one or two pools. What happens when it can't be met is set by `settings.minValuesPolicy`: `Strict` (default, the pod stays pending) or `BestEffort` (relax until satisfiable).

### 5.2 Limits

`limits` caps the **sum** of capacity a pool has launched (`cpu`, `memory`, `nvidia.com/gpu`, `nodes`). Once it's reached, the pool launches nothing and pods fall to a lower-weight pool or stay Pending. It's eventually consistent, so a burst can overshoot slightly. There's **no cluster-wide limit**. Every pool needs its own. Treat limits as a **circuit breaker against runaway cost** (a bad HPA, a crash loop with an HPA min), not as a sizing tool. Set it well above normal peak, and alert when usage gets near it.

### 5.3 `expireAfter` and `terminationGracePeriod`

- **`expireAfter`** (default `720h`): the most a node may live. When it's reached, the node is drained **forcefully**, meaning **budgets don't apply** (section 6.4). It guarantees nodes get refreshed (patched AMIs, rotated credentials, no long-lived snowflakes). `Never` turns it off.
- **`terminationGracePeriod`** (unset by default): once a node starts draining, this is the most it may take. When the time is up, remaining pods are force-deleted. Pods whose own `terminationGracePeriodSeconds` would run past the deadline are deleted early, so they still get their full shutdown window. **Without it, one PDB with `maxUnavailable: 0` or one `do-not-disrupt` pod can keep a node (and the money it costs) alive forever.**

Changing either field in a NodePool **drifts** every existing node in it, because NodeClaims are immutable.

### 5.4 Static NodePools (`spec.replicas`)

Alpha, behind the `StaticCapacity` gate (since v1.8). Setting `replicas` turns the pool into a fixed node count, like a node group. Such a pool is never consolidated, can't have `weight`, allows only `limits.nodes`, and you scale it with `kubectl scale nodepool X --replicas=N`. It can't be switched back to dynamic. Use it for capacity you deliberately want flat. (Skip v1.8.4, which has a known scheduling regression.)

---

## 6. Disruption: how Karpenter takes nodes away

This is the part to understand deeply, because it's where outages come from.

### 6.1 The methods

```
                         ┌───────────────── GRACEFUL (voluntary) ────────────────┐
                         │  respect: NodePool budgets, PDBs, do-not-disrupt      │
                         │  pre-spin replacement before draining                 │
order evaluated  ──────► │  1. Node repair (if gate on)   reason: Unhealthy      │
(one at a time)          │  2. Drift                      reason: Drifted        │
                         │  3. Consolidation              reason: Empty /        │
                         │                                        Underutilized  │
                         └───────────────────────────────────────────────────────┘
                         ┌───────────────── FORCEFUL (involuntary) ──────────────┐
                         │  NOT limited by budgets; PDBs respected only until    │
                         │  terminationGracePeriod                                │
                         │  • Expiration      (expireAfter reached)              │
                         │  • Interruption    (spot reclaim, health event, stop) │
                         │  • Manual delete   (kubectl delete node/nodeclaim)    │
                         └───────────────────────────────────────────────────────┘
```

Every graceful action follows the same steps:

```
1. find candidates (skip nodes whose pods can't be evicted)
2. check the NodePool budget for this reason; run a scheduling simulation
3. taint candidate  karpenter.sh/disrupted:NoSchedule
4. launch replacement(s), WAIT until Ready      (failure → untaint, start over)
5. delete the old node → termination flow:
     evict pods via Eviction API (PDBs honoured)
     → wait for VolumeAttachments to detach
     → terminate EC2 instance
     → remove finalizer
6. loop
```

Because step 4 happens before step 5, a graceful replacement never leaves pods with nowhere to go. The cost is a short window where both the old and new node are billed.

### 6.2 Consolidation: where the money comes from

**Policies:**

| `consolidationPolicy` | Removes | Replaces with cheaper | When to use |
|---|---|---|---|
| `WhenEmpty` | nodes with no non-DaemonSet pods | no | the safest first step; recovers capacity after scale-in |
| `WhenEmptyOrUnderutilized` (**default**) | empty nodes, and nodes whose pods fit elsewhere | yes | maximum savings; moves pods often |
| `Balanced` (v1.14+) | empty and *clearly* underutilized nodes | yes, if worth it | skips moves where pod disruption outweighs the saving |

**Types, tried in this order:**

1. **Empty**: delete every empty node in parallel.
2. **Multi-node**: can N nodes be replaced by ≤1 cheaper node? (heuristic search)
3. **Single-node**: for each node: delete it (its pods fit elsewhere) or replace it with one cheaper node.

Candidates are preferred when they have fewer pods, expire sooner, run lower-priority pods, or have a lower total `karpenter.sh/disruption-cost`.

**Worked example (Underutilized):**

```
Before                                   After
node A  m7i.2xlarge (8 vCPU)  3.0 req    node A  m7i.2xlarge  6.5 req   (absorbs B's pods)
node B  m7i.2xlarge (8 vCPU)  3.5 req    node B  — deleted —
node C  m7i.xlarge  (4 vCPU)  1.0 req    node C  replaced by m7i.large (2 vCPU) 1.0 req
cost    2×$0.40 + $0.20 = $1.00/h        cost    $0.40 + $0.10 = $0.50/h
```

Karpenter only does this if the simulation shows every pod still fits, **and** the budget allows it, **and** no PDB or `do-not-disrupt` blocks it.

**`consolidateAfter`** is how long a node must go **without a pod being added or removed** before it becomes a candidate. The timer resets on every pod change. `0s` (the default) reacts instantly and churns. `1m`–`10m` is typical. Long values (`30m`+) mean slow savings but very few moves. Since v1.14 it also applies to *destination* nodes, so a freshly launched node isn't immediately treated as a consolidation target either.

**`Balanced` scoring:** each move gets a score that compares cost saved with pods disrupted (every pod weighs the same unless you set `karpenter.sh/disruption-cost`). Approved moves emit a `ConsolidationApproved` event. Look at the `karpenter_consolidation_score` and `karpenter_consolidation_moves_total` metrics to see what it would and wouldn't do.

**Spot and consolidation:** *deleting* spot nodes is always allowed. *Replacing* a spot node with a cheaper spot node needs the `SpotToSpotConsolidation` gate (alpha), and for a single-node replace it needs at least 15 cheaper candidate types. Otherwise Karpenter would keep chasing the cheapest pool, which is the one most likely to be interrupted.

**Things that silently block consolidation:**

- a PDB that allows 0 disruptions right now (`maxUnavailable: 0`, or `minAvailable` equal to the replica count, or pods that aren't Ready)
- a pod annotated `karpenter.sh/do-not-disrupt: "true"`
- a node annotated `karpenter.sh/do-not-disrupt: "true"`
- **preferred** pod anti-affinity or `ScheduleAnyway` spread: Karpenter won't make a move that breaks a preference it once honoured
- required anti-affinity or hostname spread that leaves the pods nowhere else to go
- pods that fit nowhere else (their requirements match only this node's shape)
- the budget for `Underutilized` / `Empty` is 0 at this moment
- `consolidateAfter` keeps resetting because a CronJob or crash loop touches the node every few minutes

Karpenter logs these as **events on the node and NodeClaim** (`DisruptionBlocked` with a reason):

```bash
kubectl get events -A --field-selector reason=DisruptionBlocked
kubectl describe node <node> | sed -n '/Events/,$p'
```

### 6.3 Drift: "this node no longer matches its spec"

Karpenter hashes the node template and compares it with each NodeClaim. A node is **drifted** when:

- you changed the NodePool template: requirements, labels, taints, `expireAfter`, `terminationGracePeriod`, `nodeClassRef`
- you changed the EC2NodeClass: subnets, security groups, AMI selector, user data, block devices, kubelet, tags, IMDS…
- **the AMI selector now resolves to a different AMI.** With `alias: al2023@latest`, this happens every time AWS publishes an AMI, and after every control-plane upgrade.
- the cluster CA bundle changed (v1.12+)

Changes to `weight`, `limits` and `disruption.*` do **not** cause drift.

Drift is graceful and budgeted (reason `Drifted`), so **budgets are how you control AMI and config rollouts**. If the NodePool has `terminationGracePeriod`, drift also proceeds past blocking PDBs and `do-not-disrupt` pods once that period runs out.

### 6.4 Expiration

Forceful. Budgets don't apply, so with `expireAfter: 720h`, nodes launched together (after a scale-up or a drift wave) **expire together** 30 days later. PDBs are still respected during the drain, until `terminationGracePeriod` runs out. Two consequences:

- if you set `expireAfter`, also set `terminationGracePeriod`, or one blocked pod pins an expired node indefinitely;
- after a mass replacement, expect a matching expiry wave later. Some teams set `expireAfter: Never` and refresh nodes via drift (AMI bumps) under budgets instead, which keeps every refresh rate-limited.

### 6.5 Interruption

Spot interruption (2-minute warning), scheduled maintenance, and instance stop/terminate events. Karpenter taints the node, launches a replacement immediately, and drains. Two minutes is short: pods with slow shutdown (long `preStop`, big in-memory state) won't finish. That's why spot suits stateless, fast-starting, replicated workloads.

### 6.6 Node repair (alpha, `NodeRepair` gate)

Replaces nodes stuck with an unhealthy condition, for example `Ready=False/Unknown` for 30 min, or `AcceleratedHardwareReady`, `StorageReady`, `NetworkingReady`, `KernelReady` or `ContainerRuntimeReady` reported by an agent like the EKS Node Monitoring Agent. Since **v1.15** it's a *graceful* method: it pre-spins a replacement and uses budgets with reason `Unhealthy`, NotReady nodes don't count against that budget, and it respects `do-not-disrupt`, except that the node-level `karpenter.sh/do-not-repair` opts out. A circuit breaker stops repair in a NodePool if more than 20% of its nodes are unhealthy, because at that point the cause isn't the nodes. `--legacy-node-repair` brings back the old forceful controller (being deprecated). The `RebootForRepair` AWS gate can reboot in place for certain GPU faults.

### 6.7 Terminate-first (alpha, v1.15)

Normally the replacement is launched before the old node is drained. When capacity is pinned (a full ODCR or capacity block, or a static pool at its node limit), there's nowhere to launch the replacement. The gates `TerminateFirstDrift` and `TerminateFirstRepair` reverse the order. Capacity drops during the swap, so only enable them where you need them.

---

## 7. The safety controls

These are the controls that let you turn disruption on without fear. The cluster-side ones are set on the NodePool, the application-side ones on the pod.

### 7.1 NodePool disruption budgets

```yaml
disruption:
  budgets:
    - nodes: "10%"                        # baseline: at most 10% of the pool's nodes disrupting at once
    - nodes: "2"                          # AND at most 2 at a time (the most restrictive budget wins)
    - nodes: "0"                          # no drift during business hours (UTC cron only)
      reasons: ["Drifted"]
      schedule: "0 3 * * mon-fri"         # 03:00 UTC
      duration: 12h
    - nodes: "0"                          # nothing voluntary at the weekend
      schedule: "0 0 * * sat"
      duration: 48h
```

- `nodes`: a percentage (rounded up) or an absolute number. The allowance is reduced by nodes already deleting or NotReady.
- `reasons`: `Drifted`, `Underutilized`, `Empty`, `Unhealthy`. If omitted, the budget applies to all of them.
- `schedule` + `duration`: an active window. Cron in **UTC only**. Without both, the budget always applies.
- Several budgets → **the most restrictive one that's active wins**.
- No budgets at all → an implicit `nodes: 10%`.
- `nodes: "0"` with no schedule turns off voluntary disruption for the pool.
- Budgets **don't** stop expiration, interruption or manual deletes.

A budget limits *how many nodes*, not *which pods*. Protecting individual applications is the job of PDBs.

### 7.2 PodDisruptionBudgets (application-side)

Karpenter evicts through the Eviction API, so every PDB is respected. One PDB that currently allows 0 evictions blocks voluntary disruption of the **whole node**. Before turning on consolidation:

| Workload | Sensible PDB |
|---|---|
| stateless, ≥2 replicas | `maxUnavailable: 1` or `25%` |
| quorum system (etcd, ZooKeeper, Kafka) | `maxUnavailable: 1` |
| single replica | there's no safe PDB; `minAvailable: 1` means never move it. Go to 2 replicas, or accept the restart. |
| a PDB that blocks forever (`maxUnavailable: 0`) | treat it as a bug unless it's deliberate, and pair it with `terminationGracePeriod` |

### 7.3 Pod annotations

| Annotation | Effect |
|---|---|
| `karpenter.sh/do-not-disrupt: "true"` | blocks consolidation of the node, and drift (unless the pool has `terminationGracePeriod`). Does **not** block expiry, interruption, repair or manual delete. |
| `karpenter.sh/do-not-disrupt: "30m"` | the same, but only for the first 30 min after the pod starts. Good for batch jobs and warm-up. |
| `karpenter.sh/disruption-cost: "1000"` | weights a pod as more costly to move. Karpenter prefers disrupting other nodes. Replaces the old use of `controller.kubernetes.io/pod-deletion-cost` (deprecated for this purpose in v1.15). |

Node-level: `karpenter.sh/do-not-disrupt: "true"` (no voluntary disruption except repair) and `karpenter.sh/do-not-repair: "true"`.

### 7.4 What the application has to do

Karpenter's whole job is to *move pods safely and often*. If an application can't handle being moved, consolidation will hurt it. Checklist per workload:

1. **Accurate requests**, with memory `requests == limits`.
2. **≥ 2 replicas** for anything user-facing.
3. **A PDB** (see 7.2).
4. **Topology spread** across zones *and* hostnames, so one node loss isn't a full outage.
5. **Readiness probe** that's honest, so traffic only reaches pods that can serve.
6. **Graceful shutdown**: handle SIGTERM, stop accepting new work, drain in-flight requests. Behind a load balancer, add a short `preStop` sleep so the target is deregistered before the process exits.
7. **`terminationGracePeriodSeconds`** that fits the real drain time (and for spot, < ~90 s).
8. **No local state** you can't afford to lose, or `do-not-disrupt` / a non-consolidating pool for the pods that have it.

---

## 8. EC2NodeClass: every field that matters

```yaml
apiVersion: karpenter.k8s.aws/v1
kind: EC2NodeClass
metadata:
  name: default
spec:
  role: KarpenterNodeRole-my-cluster          # or instanceProfile: (pre-created; needed without IAM endpoint access)
  amiSelectorTerms:
    - alias: al2023@v20261015                   # PIN in prod (example date); @latest only in test clusters
  subnetSelectorTerms:                          # terms ORed, fields inside a term ANDed
    - tags: { karpenter.sh/discovery: my-cluster }
  securityGroupSelectorTerms:
    - tags: { karpenter.sh/discovery: my-cluster }
  metadataOptions:                              # defaults shown; hop limit 1 blocks pods from IMDS
    httpEndpoint: enabled
    httpTokens: required
    httpPutResponseHopLimit: 1
    httpProtocolIPv6: disabled
  blockDeviceMappings:
    - deviceName: /dev/xvda
      ebs: { volumeSize: 80Gi, volumeType: gp3, encrypted: true, deleteOnTermination: true }
  kubelet:
    maxPods: 110
    systemReserved: { cpu: 100m, memory: 200Mi }
    kubeReserved:   { cpu: 200m, memory: 500Mi }
    evictionHard:   { memory.available: "5%", nodefs.available: "10%" }
  tags: { team: platform, cost-center: infra }   # on instances, volumes, launch templates
  detailedMonitoring: false
```

| Field | Notes |
|---|---|
| `role` / `instanceProfile` | exactly one. With `role`, Karpenter creates and manages the instance profile. |
| `amiSelectorTerms` | `alias: family@version` (`al2023`, `bottlerocket`, `windows20xx`; AL2 has no AMIs after Kubernetes 1.32), or `id` / `name` / `tags` / `ssmParameter`. An alias must be the only term. |
| `amiFamily` | only needed without an alias. Sets bootstrap format and default disks. |
| `subnetSelectorTerms` | if several subnets in one AZ match, Karpenter uses the one with the most free IPs. Pod-IP exhaustion (VPC CNI) shows up here first. |
| `securityGroupSelectorTerms` | every matching SG is attached. Use `karpenter.sh/discovery`, **not** `kubernetes.io/cluster/<name>`, which confuses the AWS Load Balancer Controller. |
| `capacityReservationSelectorTerms` | ODCRs and capacity blocks → capacity type `reserved`. Since v1.6, open ODCRs are **not** used unless they're selected here. |
| `kubelet` | `maxPods`, `podsPerCore`, reserved resources, eviction thresholds. AL2023 accepts any `KubeletConfiguration` field. Since v1.15, invalid kubelet config is **accepted by the API server**, then the NodeClass reports `ValidationSucceeded=False` and launches nothing, so watch the condition. CEL per-instance expressions need the `NodeClassCEL` gate (alpha). |
| `blockDeviceMappings` | defaults: 20 GiB gp3 for AL2023, which is often too small for image-heavy nodes. Disk pressure looks like random evictions. |
| `instanceStorePolicy: RAID0` | use local NVMe for ephemeral storage and images. |
| `userData` | merged with the family's bootstrap (MIME or NodeConfig for AL2023, TOML for Bottlerocket). Karpenter-generated values win. |
| `tags` | the `karpenter.sh/*`, `karpenter.k8s.aws/*` and `kubernetes.io/cluster/*` domains are reserved. |
| `associatePublicIPAddress`, `networkInterfaces`, `ipPrefixCount`, `connectionTracking`, `placementGroupSelector`, `enclaveOptions` | specialised networking, EFA, placement and Nitro Enclaves (v1.15). |

Status: `kubectl get ec2nodeclass default -o yaml` shows the resolved `status.amis`, `status.subnets` and `status.securityGroups`, and the conditions (`AMIsReady`, `SubnetsReady`, `SecurityGroupsReady`, `InstanceProfileReady`, `ValidationSucceeded`, `Ready`). **A NodeClass that isn't Ready makes every NodePool that uses it launch nothing.**

### AMI strategy

- **Test clusters:** `al2023@latest`. New AMIs arrive automatically, so you find problems there first.
- **Production:** pin (`al2023@vYYYYMMDD`, or an `id`, or `tags` that a pipeline sets after validation), and promote the pin through environments.
- A version **alias** follows control-plane upgrades: after an EKS upgrade, the same alias resolves to the AMI for the new Kubernetes version and nodes drift. An `id` / `name` pin stays fixed until you change it.
- Rolling out a new AMI = a drift wave. Budgets with `reasons: [Drifted]` and a schedule control the pace. PDBs halt it if pods stop becoming Ready.

---

## 9. Controller settings worth knowing

Set through Helm `settings.*`. Each one is also available as an env var or flag.

| Setting | Default | Meaning |
|---|---|---|
| `clusterName` | — (required) | discovery and tagging |
| `interruptionQueue` | `""` (off) | SQS queue name. Set it. |
| `batchIdleDuration` | `1s` | end the batch after this long with no new pending pods |
| `batchMaxDuration` | `10s` | hard cap on one batch. Longer = fewer, larger nodes. |
| `preferencePolicy` | `Respect` | `Ignore` treats preferred affinity and spread as absent |
| `minValuesPolicy` | `Strict` | or `BestEffort` |
| `reservedENIs` | `0` | for VPC CNI custom networking |
| `vmMemoryOverheadPercent` | `0.075` | memory subtracted for hypervisor overhead before pricing data exists |
| `isolatedVPC` | false | no internet: skip Pricing API calls (uses pricing bundled in the binary) |
| `enableZonalShift` | false | stop launching into a zone under an ARC zonal shift (v1.12+) |
| `featureGates.*` | see below | |
| `controller.resources` | 1 CPU / 1 Gi in the guide | the controller holds an in-memory model of the cluster, so size it up for large clusters |
| `logLevel` | `info` | `debug` is useful while you're learning what it decides |

Feature gates in v1.15.1:

| Gate | Default | Stage | What it unlocks |
|---|---|---|---|
| `ReservedCapacity` | **on** | beta | ODCR / capacity-block awareness |
| `SpotToSpotConsolidation` | off | alpha | replace spot with cheaper spot |
| `NodeRepair` | off | alpha | auto-replace unhealthy nodes |
| `NodeOverlay` | off | alpha | price and resource overrides |
| `StaticCapacity` | off | alpha | `spec.replicas` pools |
| `CapacityBuffer` | off | alpha | headroom buffers |
| `TerminateFirstDrift` / `TerminateFirstRepair` | off | alpha | delete-before-launch |
| `PodDeletionCostManagement` | off | alpha | steer ReplicaSet scale-in toward nodes Karpenter wants to remove (needs RBAC `patch pods`) |
| AWS: `NodeClassCEL`, `RebootForRepair`, `DRANVIDIAGPU`, `DRAEFA` | off | alpha | per-instance kubelet expressions, GPU reboot-repair, DRA device accounting |

Drift used to be a gate. It's been always-on since v1.0, and you control it with budgets (`reasons: [Drifted]`).

---

## 10. Cost: the levers, in order of payoff

### 10.1 The order

| # | Lever | How | Risk |
|---|---|---|---|
| 1 | **Right-size requests** | VPA recommendations or observed p95 usage → requests | low, as long as memory requests stay ≥ real use |
| 2 | **Consolidation** | `WhenEmpty` → `WhenEmptyOrUnderutilized` / `Balanced`, sensible `consolidateAfter` | pod churn. Needs section 7 done first. |
| 3 | **Instance flexibility** | wide requirements (several categories, generations, sizes; `minValues`) | low. More choice means cheaper and fewer ICEs. |
| 4 | **Graviton (`arm64`)** | multi-arch images, allow `arm64` | typically ~20% cheaper per vCPU on comparable families. Needs arm64 images for everything, DaemonSets included. |
| 5 | **Spot** | `capacity-type: [spot, on-demand]` on pools for stateless, interruption-tolerant workloads, plus an interruption queue | interruptions. Workloads must tolerate a 2-minute kill. |
| 6 | **Commitments** | Savings Plans apply automatically to on-demand usage. Use a weighted pool with `limits` to keep RI/ODCR-shaped capacity filled, and `NodeOverlay` to tell Karpenter about discounted prices. | over-commitment |
| 7 | **Packing strategy** | kube-scheduler `MostAllocated` scoring (the docs recommend it) fills nodes before spreading | less headroom per node, bigger blast radius. Only possible if your control plane lets you configure the scheduler. |

Without (1), every other lever optimizes against the wrong numbers.

### 10.2 Where the money leaks even with Karpenter on

- requests 5–10× actual usage, so the cluster is "full" on paper and empty in reality
- HPA `minReplicas` sized for peak, which keeps nodes alive all night
- one PDB or `do-not-disrupt` pod per node pins a whole node (find these with `DisruptionBlocked` events)
- `consolidateAfter` too long, or budgets of `0` left on from an incident
- `limits` never reached, but no alert either, so a runaway goes unnoticed
- pools that are too narrow (one instance type), so Karpenter can't pick a cheaper shape
- large DaemonSets on small nodes: allow larger sizes to spread that overhead

### 10.3 Paying for headroom on purpose: CapacityBuffer

Scale-up latency = batch window (≤10 s) + EC2 launch + boot + image pull, usually 45–120 s. If that's too slow for a traffic spike, keep spare capacity. The old trick was low-priority "pause pods" that real pods preempt. Karpenter now has this natively:

```yaml
apiVersion: autoscaling.x-k8s.io/v1beta1      # check `kubectl api-resources | grep capacitybuffer` for your version
kind: CapacityBuffer
metadata: { name: api-headroom, namespace: web }
spec:
  scalableRef: { apiGroup: apps, kind: Deployment, name: api }
  percentage: 20                               # keep room for +20% of api's replicas
  limits: { cpu: "40", memory: 80Gi }          # never more than this
```

The buffer pods are **virtual**. They exist only in Karpenter's simulation, never in the API server, so they cost nothing to schedule. The nodes that hold them are still real and billed. Empty-consolidation won't remove a node that holds buffer capacity. Requires the `CapacityBuffer` gate (alpha).

---

## 11. Observability

The controller exposes Prometheus metrics on `:8080/metrics`. The ones worth a dashboard and alerts:

| Question | Metric |
|---|---|
| How full is each pool vs its cap? | `karpenter_nodepools_usage` / `karpenter_nodepools_limit` (by `resource_type`) |
| Is consolidation doing anything? | `karpenter_voluntary_disruption_decisions_total{decision,reason,consolidation_type}`, `karpenter_voluntary_disruption_eligible_nodes{reason}` |
| How much budget is left? | `karpenter_nodepools_allowed_disruptions{reason}` |
| How many pods did disruption touch? | `karpenter_pods_disruption_initiated_total` (alpha, v1.15) |
| Node churn | `karpenter_nodeclaims_created_total`, `karpenter_nodeclaims_terminated_total`, `karpenter_nodeclaims_disrupted_total{reason}` |
| Is scale-up fast? | `karpenter_pods_provisioning_startup_duration_seconds`, `karpenter_pods_scheduling_decision_duration_seconds` |
| Are pods stuck? | `karpenter_scheduler_unschedulable_pods_count`, `karpenter_scheduler_queue_depth` |
| Is EC2 refusing us? | `karpenter_cloudprovider_instance_launch_failures_total{reason,capacity_type,zone}`, `karpenter_cloudprovider_errors_total` |
| Is spot being reclaimed? | `karpenter_interruption_received_messages_total{message_type}` |
| Is Karpenter healthy? | `karpenter_cluster_state_synced` (must be 1), `karpenter_cluster_state_unsynced_time_seconds` |
| Rough cost per pool | `karpenter_nodepools_cost_total` (alpha, an estimate, not billing) |
| Cluster utilization | `karpenter_cluster_utilization_percent{resource_type}` (alpha) |

Starter alerts:

- `karpenter_cluster_state_synced == 0` for 10 m → the controller is blind
- usage / limit > 0.8 for any pool → about to stop scaling
- unschedulable pods > 0 for 10 m → provisioning is failing (check NodeClass `Ready`, limits, ICE)
- launch failures rising for one `capacity_type` → spot pool exhaustion or quota
- NodeClaims created and terminated within minutes, repeatedly → flapping (`consolidateAfter` too low, or pods that keep moving)
- `ValidationSucceeded=False` on any EC2NodeClass → nothing will launch

v1.15 renamed some label values (budget `reason` is now lowercase; `consolidation_type` is now `empty`/`single`/`multi`; empty `error` is now `unknown`). Check dashboards and alerts after upgrading.

---

## 12. Debugging cheatsheet

**"Why is this pod Pending?"**

```bash
kubectl describe pod <pod>              # kube-scheduler + Karpenter events (Karpenter explains which pools/requirements didn't match)
kubectl get nodepools                   # READY? at limits?
kubectl get ec2nodeclasses -o wide      # READY?
kubectl logs -n <ns> deploy/karpenter -c controller | grep -i <pod-name>
```

Usual causes: no pool's requirements intersect with the pod's; the pool is at `limits`; the NodeClass isn't Ready (bad AMI selector, no subnets matched); the pod selects a label no pool declares; spot-only plus ICE; PVC pinned to an AZ the pool excludes.

**"Why isn't this node being removed?"**

```bash
kubectl describe node <node>            # look for DisruptionBlocked events
kubectl get nodeclaim <nc> -o jsonpath='{.status.conditions}' | jq   # is Consolidatable true?
kubectl get pdb -A                      # any ALLOWED DISRUPTIONS = 0?
kubectl get pods -A -o json | jq -r '.items[] | select(.metadata.annotations["karpenter.sh/do-not-disrupt"]) | "\(.metadata.namespace)/\(.metadata.name)"'
```

**"Why did my pod get moved?"**

```bash
kubectl get events -A --field-selector involvedObject.kind=Node | grep -iE 'disrupt|consolidat|drift|expir|interrupt'
kubectl logs -n <ns> deploy/karpenter -c controller | grep -E 'disrupting|consolidat|drift'
```

Every disruption logs its reason (`underutilized`, `empty`, `drifted`, `expired`, `interrupted`) and the replacement it launched.

---

## 13. A safe path from "minimal" to "full"

The general order, from least to most risk. Each step should run in a non-production cluster for a while before moving on, and be watched with the section 11 metrics.

```
Stage 0  Observe        metrics + dashboards + alerts; record a baseline (nodes, cost, utilization)
                        log every DisruptionBlocked event. That list IS your application to-do list.
Stage 1  Apps ready     requests right-sized, memory req==limit, ≥2 replicas, PDBs, zone+host spread,
                        graceful shutdown. Nothing changes in Karpenter yet.
Stage 2  Guardrails     limits on every pool, terminationGracePeriod, interruption queue,
                        pinned AMI in prod, controller off Karpenter nodes
Stage 3  WhenEmpty      consolidationPolicy: WhenEmpty, consolidateAfter: 5m, budget 10% / small absolute cap
Stage 4  Underutilized  Balanced or WhenEmptyOrUnderutilized; budgets that pause during peak hours;
                        watch churn and pod-disruption metrics
Stage 5  Refresh        drift on, with a business-hours-off budget for reason Drifted; AMI promotion flow;
                        decide expireAfter (finite + TGP, or Never + drift-driven refresh)
Stage 6  Flexibility    widen requirements, minValues on family, add arm64 where images allow
Stage 7  Spot           spot+on-demand pools for stateless workloads only; separate on-demand pool
                        (taint or weight) for stateful and slow-shutdown workloads
```

Rollback at any stage is a NodePool edit. `budgets: [{nodes: "0"}]` stops all voluntary disruption immediately without touching running pods, and changing it doesn't cause drift.

---

## 14. Version notes (v1.6 → v1.15)

| Version | What changed that you'd notice |
|---|---|
| 1.6 | ODCRs native (beta, on). Open ODCRs unused unless selected in `capacityReservationSelectorTerms`. `minValuesPolicy`. |
| 1.7 | instance-profile path change; IAM `iam:ListInstanceProfiles`; metric renames (`karpenter_pods_drained_total`) |
| 1.8 | static NodePools (`replicas`). **Avoid 1.8.4.** |
| 1.9 | reference IAM split into 5 policies |
| 1.10 | interruptible-ODCR EventBridge rule |
| 1.11 | placement groups (IAM additions) |
| 1.12 | drift on CA-bundle change; Zonal Shift (opt-in); IAM `ec2:DescribeInstanceStatus` for status-check health |
| 1.13 | CapacityBuffer (alpha) |
| 1.14 | `Balanced` consolidation; CapacityBuffer API `v1beta1`; DRA support; `consolidateAfter` applies to destination nodes; new consolidation candidate ordering |
| 1.15 | node repair becomes graceful and budgeted (`Unhealthy` reason, needs a CRD upgrade); terminate-first gates; `karpenter.sh/disruption-cost`; kubelet validation moved from the API server to the NodeClass status; Nitro Enclaves; CEL kubelet values; metric label changes |

Upgrade hygiene:

- Install CRDs with the separate **`karpenter-crd`** chart. The main chart installs CRDs only on first install and never upgrades them.
- Check the IAM policy diff for the target version before upgrading the controller.
- Kubernetes compatibility: 1.33 needs ≥1.5, 1.34 needs ≥1.6, 1.35 needs ≥1.9, 1.36 needs ≥1.13, 1.37 needs 1.15.x. **Upgrade Karpenter before the control plane**, never after.
- Read the release notes for every version in between, not only the target.

---

## 15. Glossary

- **Offering**: one (instance type, zone, capacity type) combination with a price and availability.
- **Candidate**: a node the disruption controller is considering removing.
- **Drift**: the node's spec no longer matches the NodePool/NodeClass, so it gets replaced.
- **Consolidation**: removing or shrinking nodes because their pods fit more cheaply elsewhere.
- **Budget**: the most nodes a NodePool may voluntarily disrupt at one time (by reason and schedule).
- **PDB**: the most pods of one application that may be voluntarily evicted at one time.
- **ICE**: Insufficient Capacity Error. EC2 has none of that offering right now.
- **ODCR**: On-Demand Capacity Reservation, i.e. reserved capacity type `reserved`.
- **TGP**: `terminationGracePeriod`, the most time a node may spend draining.

**One-line summary:** Karpenter adds nodes by reading pod requests and buying the cheapest machine that fits. It removes nodes by constantly asking whether a cheaper arrangement exists. Every saving comes from the second loop, and that loop is only as safe as your PDBs, budgets, requests and shutdown handling.

---

### Sources

- Karpenter docs (v1.15): [Concepts](https://karpenter.sh/docs/concepts/), [NodePools](https://karpenter.sh/docs/concepts/nodepools/), [NodeClasses](https://karpenter.sh/docs/concepts/nodeclasses/), [NodeClaims](https://karpenter.sh/docs/concepts/nodeclaims/), [Scheduling](https://karpenter.sh/docs/concepts/scheduling/), [Disruption](https://karpenter.sh/docs/concepts/disruption/), [CapacityBuffers](https://karpenter.sh/docs/concepts/capacitybuffers/), [NodeOverlays](https://karpenter.sh/docs/concepts/nodeoverlays/), [Pod Deletion Cost](https://karpenter.sh/docs/concepts/pod-deletion-cost/)
- [Settings reference](https://karpenter.sh/docs/reference/settings/), [Metrics reference](https://karpenter.sh/docs/reference/metrics/), [FAQ](https://karpenter.sh/docs/faq/), [Managing AMIs](https://karpenter.sh/docs/tasks/managing-amis/), [Upgrade guide](https://karpenter.sh/docs/upgrading/upgrade-guide/), [Compatibility](https://karpenter.sh/docs/upgrading/compatibility/), [Getting started](https://karpenter.sh/docs/getting-started/getting-started-with-karpenter/)
- Releases: [kubernetes-sigs/karpenter](https://github.com/kubernetes-sigs/karpenter/releases), [aws/karpenter-provider-aws](https://github.com/aws/karpenter-provider-aws/releases); Helm defaults from the `v1.15.1` chart `values.yaml`
- [EKS Best Practices: Karpenter](https://docs.aws.amazon.com/eks/latest/best-practices/karpenter.html)
