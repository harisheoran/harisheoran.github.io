---
title: KEDA
date: 2026-10-07
draft: false
description: "Event based scaling"
categories: ["k8s"]
tags: ["scaling"]
---

KEDA ("Kubernetes Event-Driven Autoscaling") lets Kubernetes scale your pods on what is actually waiting to be done, like queue messages, Kafka lag or a Prometheus query, instead of on CPU. It doesn't replace the built-in autoscaler. It plugs into it and fills two gaps it can't cover.

---

## 1. The problem: what Kubernetes gives you without KEDA

Kubernetes ships one autoscaler for pods, the **HPA** (Horizontal Pod Autoscaler). It runs inside `kube-controller-manager` and repeats one loop every 15 seconds:

```
every 15s:
  value   = read a metric for the workload
  desired = ceil(currentReplicas × value / target)
  set the Deployment's replica count to desired
```

That's the whole mechanism. It has three weaknesses.

**Weakness 1: CPU is the wrong signal for event-driven work.**  
Take a worker that pulls jobs from a queue and spends most of its time waiting on network calls:

```
time    queue backlog    worker CPU    what the HPA does
10:00        20             15%         nothing
10:05     5,000             18%         nothing   ← users are waiting
10:10    40,000             20%         nothing   ← still nothing
```

CPU tells you how busy the pods you already have are. It doesn't tell you how much work is waiting. The number you want is the backlog.

**Weakness 2: the HPA can read only a few kinds of metric, and each needs an adapter.**  
The HPA reads three Kubernetes APIs:

|API|Normally served by|Holds|
|---|---|---|
|`metrics.k8s.io`|metrics-server|CPU and memory|
|`custom.metrics.k8s.io`|an adapter, e.g. prometheus-adapter|metrics about Kubernetes objects|
|`external.metrics.k8s.io`|an adapter|metrics from outside the cluster (SQS, Kafka, …)|

The catch: each API is registered with a single `APIService` object, so **a cluster can have only one external-metrics adapter**. If you want SQS, Kafka, Redis and Prometheus at the same time, separate adapters won't work. You need one adapter that knows every source.

**Weakness 3: the HPA can't go to zero.**  
`minReplicas` must be at least 1. When a Deployment sits at 0 replicas, the HPA turns itself off for that workload. An idle queue worker therefore costs you at least one pod, around the clock, in every environment.

**KEDA's answer to all three:** it is a single external-metrics adapter that understands 70+ event sources, it creates and manages the HPA for you, and it handles the 0 ↔ 1 step itself because the HPA can't.

---

## 2. The components

```
┌──────────────────────────── namespace: keda ─────────────────────────────┐
│                                                                           │
│  ┌───────────────────────────────┐   gRPC   ┌──────────────────────────┐ │
│  │ keda-operator                 │◄─────────│ keda-operator-           │ │
│  │                               │          │ metrics-apiserver        │ │
│  │ • watches ScaledObject /      │          │                          │ │
│  │   ScaledJob / TriggerAuth     │          │ • registered as          │ │
│  │ • creates and updates the HPA │          │   v1beta1.external.      │ │
│  │ • runs the 0↔1 loop           │          │   metrics.k8s.io         │ │
│  │ • holds the scalers           │          │ • holds no scalers;      │ │
│  │   (one per trigger)           │          │   forwards to operator   │ │
│  └───────┬──────────────┬────────┘          └────────────▲─────────────┘ │
│          │              │                                │               │
│  ┌───────┴────────┐     │     ┌─────────────────────────┐│               │
│  │ admission      │     │     │ CRDs:                   ││               │
│  │ webhooks       │     │     │  ScaledObject           ││               │
│  │ (rejects bad   │     │     │  ScaledJob              ││               │
│  │  ScaledObjects)│     │     │  TriggerAuthentication  ││               │
│  └────────────────┘     │     │  ClusterTriggerAuth.    ││               │
│                         │     └─────────────────────────┘│               │
└─────────────────────────┼────────────────────────────────┼───────────────┘
                          │ polls the source               │ "what is metric X?"
                          ▼                                │
              ┌───────────────────────┐        ┌───────────┴─────────────┐
              │ event source          │        │ HPA controller          │
              │ SQS / Kafka / Prom /  │        │ (kube-controller-       │
              │ Redis / cron / …      │        │  manager, every 15s)    │
              └───────────────────────┘        └───────────┬─────────────┘
                                                           │ sets replicas
                                                           ▼
                                               ┌─────────────────────────┐
                                               │ Deployment/StatefulSet  │
                                               │ (/scale subresource)    │
                                               └─────────────────────────┘
```

What each piece does:

**1. CRDs: what you write.**

- **`ScaledObject`** says: scale _this_ Deployment on _these_ triggers, between _min_ and _max_ replicas.
- **`ScaledJob`**: instead of resizing a Deployment, start one Kubernetes Job per batch of events. Use it for long tasks that must not be killed halfway by a scale-down.
- **`TriggerAuthentication`** / **`ClusterTriggerAuthentication`** say how KEDA logs in to the source. Options include a Secret, pod identity, IRSA, and others.

**2. Scalers: the plugins.**  
A scaler is Go code compiled into the operator, one type per source (`aws-sqs-queue`, `prometheus`, `kafka`, `cron`, `cpu`, …). Each one implements three things:

- `GetMetricSpecForScaling()`: "my metric is called X and its target is Y."
- `GetMetricsAndActivity()`: "the value right now is V, and active = V > activationThreshold."
- `Close()`: release connections.

There is also the `external` scaler type. KEDA calls your own gRPC server for the number. The Kedify OTel add-on you've worked with is one of these.

**3. keda-operator: the brain.**  
It runs two independent jobs:

- **Reconciler.** When a ScaledObject changes, it builds a matching HPA object (`keda-hpa-<name>`) and keeps it in sync. **Don't edit that HPA by hand.** KEDA owns it and will overwrite your changes.
- **Scale loop.** One goroutine per ScaledObject. Every `pollingInterval` (default 30s) it asks each scaler "are you active?" and handles 0 ↔ 1 itself.

**4. keda-operator-metrics-apiserver: the adapter.**  
This is what the HPA talks to. It does no metric work of its own. Each request is forwarded to the operator over gRPC, so the operator keeps one connection pool and one cache per source.

**5. Admission webhooks.**  
These reject mistakes before they reach the cluster: two ScaledObjects on the same Deployment, a ScaledObject on a workload that already has a hand-written HPA, or a CPU trigger on pods with no CPU `requests`.

---

## 3. How it works: two phases with two owners

This is the most important idea in KEDA: **scaling is split into two phases, and each has a different owner.**

```
replicas
   ▲
 N │                         ┌──────────┐
   │                    ┌────┘          └───┐        PHASE 2: 1 ↔ N
   │               ┌────┘                   └──┐     owner: HPA
   │          ┌────┘                           │     (KEDA only supplies the metric)
 1 │     ┌────┘                                └────────┐
   │     │                                              │  cooldownPeriod
 0 │─────┘ PHASE 1: 0 → 1                               └──────────
   │       owner: keda-operator                  PHASE 1: 1 → 0
   └────────────────────────────────────────────────────────────────► time
```

### Phase 1: activation (0 ↔ 1), owned by the keda-operator

```
every pollingInterval (30s):
  for each trigger: active = (metric > activationThreshold)

  if any trigger is active:
      if replicas == 0: set replicas to max(minReplicaCount, 1)
      remember lastActiveTime = now
  else if all triggers inactive
       and now - lastActiveTime > cooldownPeriod (300s)
       and minReplicaCount == 0:
      set replicas to 0
```

The operator does this by writing straight to the Deployment's `/scale` subresource, the same endpoint `kubectl scale` uses.

### Phase 2: scaling (1 ↔ N), owned by the HPA

KEDA has already turned your trigger into an `External` metric on the HPA. Roughly:

```yaml
# keda-hpa-orders-worker  (generated by KEDA; do not edit)
spec:
  minReplicas: 1          # max(minReplicaCount, 1); the HPA can't hold 0
  maxReplicas: 30
  metrics:
  - type: External
    external:
      metric:
        name: s0-aws-sqs-queue-orders          # s<trigger index>-<scaler>-<name>
        selector:
          matchLabels:
            scaledobject.keda.sh/name: orders-worker
      target:
        type: AverageValue
        averageValue: "50"
```

Every 15s the HPA controller makes a call like this:

```
GET /apis/external.metrics.k8s.io/v1beta1/namespaces/orders/s0-aws-sqs-queue-orders
    ?labelSelector=scaledobject.keda.sh/name=orders-worker
```

That request is the gRPC hop from section 2. Here is the full path, hop by hop:

```
HPA controller ──HTTP──► kube-apiserver ──proxy──► keda metrics-apiserver
                                                         │ gRPC
                                                         ▼
                                                   keda-operator
                                                         │ scaler.GetMetricsAndActivity()
                                                         ▼
                                                  AWS SQS GetQueueAttributes
                                                         │
                         value = 380 ◄───────────────────┘
```

Then the HPA does its arithmetic. With an `AverageValue` target, the KEDA default for most scalers:

```
desired = ceil(metricValue / targetPerPod) = ceil(380 / 50) = 8 pods
```

Then the HPA's own safety rules apply:

- If the change is within ±10% of the current value, it does nothing.
- Scale-down waits through a 300s stabilization window.
- With several triggers it computes desired for each one and takes the **highest**.
- The result is clamped to [min, max].

**Why the split?** The HPA's formula divides by the current replica count. At 0 replicas there is nothing to divide by, and the HPA disables itself for that target. KEDA only needs a yes/no answer ("is there any work at all?") to get from 0 to 1. After that, the HPA's tested, well-damped formula takes over.

---

## 4. Worked example: an SQS worker over one day

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: orders-worker
  namespace: orders
spec:
  scaleTargetRef:
    name: orders-worker          # the Deployment
  pollingInterval: 30            # operator checks every 30s
  cooldownPeriod: 300            # idle 5 min → 0
  minReplicaCount: 0
  maxReplicaCount: 30
  fallback:                      # if SQS can't be read 3 times in a row,
    failureThreshold: 3          # hold 5 replicas instead of guessing
    replicas: 5
  triggers:
  - type: aws-sqs-queue
    authenticationRef:
      kind: ClusterTriggerAuthentication
      name: aws-eks-trigger-auth # IRSA identity of the keda-operator SA
    metadata:
      queueURL: https://sqs.ap-south-1.amazonaws.com/<acct>/orders
      queueLength: "50"          # target: 50 messages per pod
      activationQueueLength: "0" # any message at all → wake up
      awsRegion: ap-south-1
```

|Time|Messages in queue|Who acts|Calculation|Replicas|
|---|---|---|---|---|
|02:00|0|–|idle|**0** (costs nothing)|
|08:00:10|12|operator|12 > 0, active, and replicas are 0|0 → **1**|
|08:00:30|12|HPA|ceil(12/50) = 1|1|
|09:00|380|HPA|ceil(380/50) = 8|**8**|
|12:00|2,400|HPA|ceil(2400/50) = 48, capped at max|**30**|
|18:00|40|HPA|ceil(40/50) = 1, after the 300s stabilization window|**1**|
|18:10|0|operator|inactive since 18:05, cooldown 300s runs out|1 → **0**|

**How this connects to node scaling.** KEDA scales pods, not nodes. When it asks for 30 pods and only 10 fit, the other 20 sit in `Pending`. **Karpenter** sees those and adds nodes. The full chain is: event → KEDA → HPA → Pending pods → Karpenter → EC2.

Your NodePool `limits` are the final cap. If they're full, KEDA can ask for as many pods as it likes and they'll stay Pending. That is what happened in the 2026-09-29 prod-vistaar capacity wedge.

---
## 5. Knobs and behaviours worth knowing

|Knob or behaviour|Default|What it controls|
|---|---|---|
|`pollingInterval`|30s|How often the operator checks for 0↔1. It does **not** control the HPA, which always polls every 15s.|
|`cooldownPeriod`|300s|Idle time before going 1 → 0. Applies **only** to that step.|
|`activationThreshold` (per trigger)|0|The "wake up" bar, separate from the scaling target.|
|`advanced.horizontalPodAutoscalerConfig.behavior`|HPA defaults|Scale-up and scale-down speed for 1↔N. This is where flapping gets fixed.|
|`useCachedMetrics` (per trigger)|false|When true, the HPA gets the operator's last polled value instead of a fresh query on every request. This cuts calls to the source.|
|`fallback`|off|Replica count to hold when the scaler keeps failing.|
|`autoscaling.keda.sh/paused-replicas: "N"` annotation|–|Freezes the workload at N replicas. Useful during incidents and migrations.|
|Multiple triggers|–|Active if **any** trigger is active. The replica count follows whichever trigger asks for the most.|

**One-line summary:** the KEDA operator answers "is there any work?" (0 ↔ 1). The HPA answers "how much?" (1 ↔ N), using numbers KEDA supplies through the one external-metrics adapter slot. Karpenter then finds nodes for the pods.