---
title: Kubernetes Network Policies, eBPF and Cilium
date: 2026-10-29
draft: false
description: "Firewalling pods from first principles: why IP rules fail, how NetworkPolicy works, how eBPF and Cilium enforce it, and what it costs in latency"
categories: ["networking"]
tags: ["k8s", "security", "ebpf", "cilium"]
---
A fresh Kubernetes cluster is one flat network: **every pod can open a connection to every other pod**, in every namespace, on every port. That's deliberate. It's rule 3 of the network model in part 1. It's also the reason a single compromised pod can reach your database.

Network policies are the firewall for that flat network. This note builds them from first principles: why ordinary firewalls don't work for pods, what the NetworkPolicy API actually means, how a plugin turns YAML into kernel state, what eBPF is, how Cilium uses it, and what all of it costs in latency.

Read [Kubernetes Networking](../kubernetes-networking/) first. This note assumes you know what a veth, conntrack, DNAT and a Service ClusterIP are.

Versions this note is written against (October 2026):

| Thing | Version |
|---|---|
| Kubernetes | v1.37 (NetworkPolicy is `networking.k8s.io/v1`, unchanged in years) |
| network-policy-api (ClusterNetworkPolicy) | v0.2.x, API `v1alpha2`, beta targeted for late 2026 |
| Cilium | 1.20.4 (1.20.0 released July 2026) |
| Calico | 3.33 |

---

## 1. The problem

### 1.1 Flat networks make lateral movement easy

```
 namespace: shop                         namespace: data
 ┌───────────┐   ┌───────────┐           ┌───────────┐
 │ frontend  │──►│  orders   │──────────►│ postgres  │
 └───────────┘   └───────────┘           └───────────┘
       │                                       ▲
       │   nothing stops this ─────────────────┘
       │
       ▼                                 namespace: tools
  (attacker gets RCE in frontend)        ┌────────────┐
       └────────────────────────────────►│ admin-api  │
                                         └────────────┘
```

The frontend only ever needs to talk to `orders`. But if it's compromised, it can scan the whole pod CIDR, reach the database directly, hit internal admin APIs that "nobody outside can reach", and call any external address on the internet to exfiltrate data.

The security idea is **least privilege for the network**: each workload can reach only what it needs. If something is compromised, the damage stays small ("blast radius"). This is also what most compliance frameworks mean by "network segmentation".

### 1.2 Why the firewalls you already have don't help

You probably already have cloud security groups or a perimeter firewall. They fail inside a cluster for three reasons that come straight from part 1:

1. **Pod IPs are ephemeral.** A rule like "allow 10.244.1.5 → 10.244.2.7:5432" is wrong the next time either pod restarts. Pods reschedule all day.
2. **Many workloads share one node.** Pod-to-pod traffic on the same node never leaves the machine, so no external firewall ever sees it. Traffic leaving the node may be SNATed to the node's IP, so the outside world can't tell which pod sent it.
3. **The firewall's unit is wrong.** Security groups attach to machines or network interfaces. The thing you want to protect is "the `orders` workload", which is a label, not a machine.

So the firewall has to:

- live **on every node, at the pod's own interface** (the veth from part 1),
- be written in terms of **labels** ("pods with `app=orders`"), not IPs,
- and be **recomputed continuously** as pods come and go.

That's exactly what a NetworkPolicy implementation is: a controller that translates label rules into per-pod kernel rules and keeps them in sync.

```
 what you write                       what the kernel needs
 ──────────────                       ─────────────────────
 "pods app=orders may receive         "on node B, packets arriving at veth-c
  from pods app=frontend on 8080"      (10.244.2.7) on TCP 8080 are allowed
                                       only from {10.244.1.5, 10.244.3.4}"
                 │                                 ▲
                 └──── policy controller ──────────┘
                       (watches pods, namespaces, policies;
                        recomputes on every change)
```

---

## 2. NetworkPolicy, from first principles

### 2.1 The API server only stores it

`NetworkPolicy` is a built-in object, but **Kubernetes itself enforces nothing**. The docs put it bluntly: creating one "without a controller that implements it will have no effect". Enforcement comes from your CNI plugin (Calico, Cilium, Antrea, a cloud CNI's policy agent…). If your CNI doesn't implement it, `kubectl apply` succeeds and nothing happens. Check this first.

### 2.2 The rules of the game

There are only six rules. Everything else is syntax.

**Rule 1: default allow.** A pod no policy selects is not isolated. All traffic in and out is allowed.

**Rule 2: selection isolates, per direction.** Once any policy selects a pod and lists `Ingress` in `policyTypes`, that pod's ingress becomes **deny-by-default**: only what some policy allows gets in. Same for `Egress`, independently.

```
 pod with no policy:        all in ✓   all out ✓
 selected for Ingress:      in = only what's allowed   out ✓
 selected for Egress:       in ✓   out = only what's allowed
 selected for both:         in and out = only what's allowed
```

**Rule 3: policies only add allows. No deny rules, no order.** If several policies select the same pod, the allowed set is the **union** of all of them. You can't write "deny X". You can't override another policy. Order doesn't matter. This makes the model easy to reason about: adding a policy can only open more traffic for already-isolated pods (or isolate a pod that wasn't isolated yet).

**Rule 4: both ends must agree.** A connection from A to B succeeds only if A's egress allows it **and** B's ingress allows it. They're checked separately, often on different nodes.

```
   pod A (node 1)                         pod B (node 2)
   ┌──────────┐   egress check            ┌──────────┐
   │          │──► A allowed to send ──►  │          │
   │          │    to B:8080?             │          │
   └──────────┘                 ingress check: B allowed to
                                receive from A on 8080?
          connection works only if BOTH say yes
```

**Rule 5: replies are free.** If a connection is allowed, its reply packets are allowed automatically (that's conntrack, from part 1). You write rules for the direction that opens the connection only.

**Rule 6: the node is always allowed.** Traffic between a pod and its own node isn't blocked. That's why kubelet probes keep working under default-deny.

### 2.3 Anatomy of a policy

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: orders-ingress
  namespace: shop
spec:
  podSelector:              # WHICH pods this policy is about (in this namespace)
    matchLabels:
      app: orders
  policyTypes: [Ingress]    # WHICH directions become isolated
  ingress:                  # WHAT is allowed in (a list: each item is OR'd)
    - from:                 #   from these peers…
        - podSelector:
            matchLabels:
              app: frontend
      ports:                #   …to these ports (AND with "from")
        - protocol: TCP
          port: 8080
```

Read it as: "pods `app=orders` in `shop` are ingress-isolated; allow TCP 8080 from pods `app=frontend` in `shop`."

The three peer types:

| Peer | Matches |
|---|---|
| `podSelector` | pods with these labels, **in the policy's own namespace** |
| `namespaceSelector` | all pods in namespaces with these labels |
| `namespaceSelector` + `podSelector` in **one** item | pods with these labels **in** namespaces with those labels |
| `ipBlock` | a CIDR, with optional `except` holes. Meant for addresses **outside** the cluster. |

Every namespace automatically gets the label `kubernetes.io/metadata.name: <name>`, so selecting one namespace by name is easy.

`ports` can be a number, a named container port, or a range with `endPort` (stable since v1.25).

### 2.4 The AND/OR trap

This is the most common mistake in NetworkPolicy YAML. One dash makes all the difference:

```yaml
# ONE peer with two selectors  →  AND
ingress:
  - from:
      - namespaceSelector:
          matchLabels: {team: payments}
        podSelector:                      # no dash: same list item
          matchLabels: {role: client}
# allows: pods role=client that are IN namespaces team=payments
```

```yaml
# TWO peers  →  OR
ingress:
  - from:
      - namespaceSelector:
          matchLabels: {team: payments}
      - podSelector:                      # dash: a new list item
          matchLabels: {role: client}
# allows: ANY pod in team=payments namespaces,
#         OR pods role=client in THIS namespace
```

The second one is much wider than people intend. `kubectl describe networkpolicy <name>` prints how Kubernetes actually parsed it. Use it.

Same idea one level up: items in `ingress:` are OR'd with each other; inside one item, `from` and `ports` are AND'd.

### 2.5 The patterns you actually use

**Default deny everything in a namespace** (selects all pods, allows nothing):

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: default-deny, namespace: shop}
spec:
  podSelector: {}                 # empty = every pod in the namespace
  policyTypes: [Ingress, Egress]  # no ingress/egress lists = nothing allowed
```

**Allow DNS** (needed the moment you deny egress; see section 9):

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: allow-dns, namespace: shop}
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector:
            matchLabels: {kubernetes.io/metadata.name: kube-system}
          podSelector:
            matchLabels: {k8s-app: kube-dns}
      ports:
        - {protocol: UDP, port: 53}
        - {protocol: TCP, port: 53}   # DNS falls back to TCP for large answers
```

**Allow one app to call another across namespaces** needs two policies, because of rule 4: egress on the caller side and ingress on the callee side.

**Allow egress to an external range:**

```yaml
egress:
  - to:
      - ipBlock:
          cidr: 192.0.2.0/24
    ports:
      - {protocol: TCP, port: 443}
```

### 2.6 Policies see pod IPs, not Services

From part 1: a Service ClusterIP is DNATed to a pod IP before the packet reaches the destination. So you never write a rule about a Service. You write it about the **backend pods' labels and their container port** (`targetPort`, not the Service `port`). The spec even says the order of NAT and policy processing is "not defined", so an `ipBlock` aimed at a Service IP may or may not match. Don't do it.

On ingress from outside the cluster, the source IP you see may be the load balancer or a node (section 7.6 of part 1: `externalTrafficPolicy: Cluster` SNATs). An `ipBlock` allowing "the office CIDR" only works if the client IP survives to the pod.

### 2.7 What NetworkPolicy cannot do

From the docs' own list:

- **No explicit deny** and no priorities. You can only add allows.
- **No L7.** It's IPs, ports and protocols. "Allow GET /health but not POST /admin" is impossible.
- **No DNS names.** "Allow egress to `api.example.com`" is impossible; you'd need its IPs, which change.
- **No cluster-wide default.** Policies are namespaced. You can't say "every namespace starts default-deny" with one object.
- **No logging** of allowed or dropped traffic.
- **No targeting Services by name**, no node-specific policies (you can only use CIDRs).
- **Can't block** a pod's loopback or traffic from its own node.
- **No TLS / identity.** It trusts that an IP belongs to the pod it says it does.
- **No way to know when a policy is enforced.** It's applied asynchronously.

Everything after this point (ClusterNetworkPolicy, Cilium policies, service meshes) exists to fill gaps in this list.

---

## 3. How a plugin enforces policy: the generic loop

Every implementation, whatever the data plane, runs the same loop on every node:

```
             ┌──────────────── API server ────────────────┐
             │ NetworkPolicies   Pods (labels, IPs)        │
             │ Namespaces (labels)                         │
             └───────────────┬─────────────────────────────┘
                             │ watch
                             ▼
   ┌──────────────────────────────────────────────────────────┐
   │ policy agent (DaemonSet, one per node)                   │
   │                                                          │
   │ for each LOCAL pod:                                      │
   │   which policies select it?                              │
   │   → ingress allowed peers: resolve selectors → set of    │
   │     IPs (or identities) + ports                          │
   │   → egress allowed peers:  same                          │
   │ program the result into the kernel                       │
   └───────────────────────────┬──────────────────────────────┘
                               ▼
     kernel data plane at each pod's veth / hook:
       iptables + ipsets   |   nftables sets   |   eBPF maps   |   OVS flows
```

The expensive part is the arrow in the middle: **selectors have to be resolved into addresses**, and every pod creation anywhere in the cluster can change the answer. If `app=frontend` gets a new replica on node 7, every node that hosts a pod allowing `app=frontend` must add that new IP to its allowed set, and quickly. That's a lot of fan-out, and it's where the classic iptables designs and the eBPF/identity designs differ.

### 3.1 The iptables way (classic Calico, kube-router, many others)

Per pod, a chain of rules at the veth. Allowed peers are kept in **ipsets** (kernel hash sets of IPs) so one rule can match thousands of IPs:

```
 packet to pod orders (10.244.2.7) arrives
   │
   ▼
 FORWARD → per-endpoint chain "cali-tw-veth-c"
   ├─ ct state established,related  → ACCEPT     ← replies and existing flows (rule 5)
   ├─ src ∈ ipset "frontend-pods" && tcp dport 8080 → ACCEPT
   ├─ src ∈ ipset "monitoring"    && tcp dport 9090 → ACCEPT
   └─ DROP
```

This works and is battle-tested. Its costs come from the shape of iptables:

- When a frontend pod is created, every relevant node updates the ipset. That part is cheap.
- When **policies** change, chains get rewritten, and iptables updates replace whole tables under a global lock. Large clusters with many policies see slow rule programming.
- Per packet: established connections hit the first `ct state` rule and leave. New connections walk the chain. Usually cheap, but it grows with the number of rules.

nftables data planes (Calico has one; kube-network-policies uses nftables + nfqueue) fix the update and lookup shape with native sets and maps.

### 3.2 The eBPF way

Instead of chains of generic rules, attach a small **program** at the pod's interface that does exactly one hash lookup: "is (peer, port, protocol) in this pod's allowed table?". To understand why this is fast and how it works, we need eBPF.

---

## 4. eBPF from first principles

### 4.1 The problem eBPF solves

Packet processing lives in the kernel. If you want new behaviour there, your old options were:

1. **Change the kernel.** Upstream it, wait years for distributions to ship it.
2. **Write a kernel module.** Runs with full kernel privileges. One bug crashes the machine, and it breaks on kernel upgrades.
3. **Use what exists** (iptables, tc filters), which is a fixed set of generic building blocks, as in section 3.1.

eBPF adds a fourth option: **load a small program into the running kernel, which the kernel first proves is safe, and run it at a chosen hook.** It's often compared to JavaScript in the browser: a sandboxed, event-driven way to make a fixed platform programmable.

### 4.2 The life of an eBPF program

```
  C source (restricted)            user space                          kernel
 ┌──────────────────┐   clang   ┌──────────────┐  bpf() syscall  ┌──────────────────┐
 │ int handle(skb){ │ ────────► │ eBPF bytecode│ ──────────────► │ ① VERIFIER       │
 │   lookup map...  │           │ (.o file)    │                 │   - no crashes   │
 │   return DROP;   │           └──────────────┘                 │   - bounded loops│
 │ }                │                                            │   - no bad memory│
 └──────────────────┘                                            │   - no uninit    │
                                                                 │     variables    │
                                                                 ├──────────────────┤
                                                                 │ ② JIT compiler   │
                                                                 │   bytecode →     │
                                                                 │   native x86/arm │
                                                                 ├──────────────────┤
                                                                 │ ③ ATTACH to hook │
                                                                 │   (tc, XDP,      │
                                                                 │    cgroup, …)    │
                                                                 └────────┬─────────┘
                                                                          │
                                       ┌──────────── maps ────────────────┤
  agent in user space ◄── read/write ──┤  hash / LRU / array / LPM / ring │ ◄── program
  (e.g. cilium-agent)                  │  buffer … shared state           │     reads/writes
                                       └──────────────────────────────────┘
```

The four ideas that matter:

- **Verifier.** Before anything runs, the kernel walks every possible path of the program, tracking the range of every register. It rejects anything that could crash, loop forever, read out of bounds or use uninitialized memory. This is what makes it safe to run custom code in the kernel. (It checks safety, not intent: it's not a security scanner.)
- **JIT.** The verified bytecode is compiled to native machine code, so it runs about as fast as code compiled into the kernel.
- **Maps.** Key-value data structures in kernel memory, shared between eBPF programs and user space. This is the whole trick for policy: the **program** stays the same; the agent changes behaviour by updating **map entries**. Updating one map entry is a single atomic operation, not a table rewrite under a global lock.
- **Helpers.** eBPF can't call arbitrary kernel functions, only a fixed, stable API: look up a map, redirect a packet to another interface, rewrite headers, get the time, and so on.

### 4.3 Where networking programs attach

```
          NIC
           │
   ┌───────▼────────┐
   │ XDP            │  earliest point, in the driver, before the kernel allocates
   │                │  its packet structure. Fastest. Used for DDoS drop, LB.
   └───────┬────────┘
           ▼
   ┌────────────────┐
   │ tc / tcx       │  traffic control ingress/egress on any interface,
   │ ingress/egress │  including the pod's veth. Full packet + metadata.
   └───────┬────────┘  ← most policy enforcement happens here
           ▼           (tcx = newer, faster attach mechanism, kernel 6.6+)
   kernel IP stack, netfilter, routing …
           ▼
   ┌────────────────┐
   │ cgroup socket  │  runs on connect()/sendmsg()/recvmsg() of a process.
   │ hooks          │  No packet exists yet. Used for socket-level Service LB.
   └────────────────┘

   netkit (kernel 6.7+): a replacement for the veth pair whose packet path is
   itself an eBPF program, so a pod's traffic can skip the extra trip through
   the host's stack that veth needs.
```

### 4.4 Why eBPF beats iptables for this job

| | iptables | eBPF |
|---|---|---|
| Lookup shape | linear chain of generic rules (ipsets help) | hash map lookup, O(1) |
| Updates | rewrite chains, global lock | update individual map entries atomically |
| Logic | fixed match/target vocabulary | arbitrary (verified) code: identities, L4 LB, encap, metrics |
| Where it runs | netfilter hooks inside the full IP stack | can run earlier (tc, XDP) and skip parts of the stack |
| Observability | packet/byte counters per rule | the program can emit an event for every drop with full context |

eBPF isn't magic, though. The gains are biggest at scale (many Services, many policies, lots of pod churn) and on hot paths. On a small cluster, iptables is rarely the bottleneck. eBPF also needs a reasonably modern kernel, and debugging it needs new tools (`bpftool`, Hubble) instead of `iptables -L`.

---

## 5. Cilium

**Cilium** is a CNI plugin whose entire data plane is eBPF. It's a CNCF graduated project (since October 2023). It does pod networking, replaces kube-proxy, enforces network policy (Kubernetes' own plus richer Cilium policies), encrypts traffic (WireGuard/IPsec), and gives you flow visibility (Hubble).

### 5.1 Components

```
 ┌──────────────────────────── each node ─────────────────────────────┐
 │                                                                    │
 │  cilium-agent (DaemonSet)                                          │
 │   - watches pods, Services, policies, nodes                        │
 │   - computes identities and policies                               │
 │   - compiles/loads eBPF programs, writes eBPF maps                 │
 │   - embeds the Hubble server (flow events)                         │
 │   - runs the DNS proxy (for FQDN policies)                         │
 │                                                                    │
 │  cilium-envoy (DaemonSet, or embedded)  ← only used for L7 rules   │
 │                                                                    │
 │  cilium-cni binary  ← called by the runtime on pod create/delete   │
 │                                                                    │
 │  eBPF programs on: pod veths/netkit, host interfaces, cgroup hooks │
 │  eBPF maps: ipcache, policy, conntrack, NAT, services, …           │
 └────────────────────────────────────────────────────────────────────┘

 cilium-operator (Deployment): cluster-wide chores (IPAM, garbage
 collection). Not in the packet path: if it's down, traffic still flows.

 hubble-relay + UI: aggregates every node's flow events cluster-wide.
```

State lives in CRDs by default (`CiliumIdentity`, `CiliumEndpoint`, `CiliumNode`, …). No separate etcd is needed.

### 5.2 The key idea: identity instead of IP

Section 3 showed the expensive part of enforcement: resolving selectors into IP sets and pushing every pod IP change to every node. Cilium changes what the rules are written in.

**Step 1: labels → identity.** The agent takes a pod's security-relevant labels (`app=frontend`, namespace, service account…) and maps the label set to a **numeric security identity**. Every pod with the same label set gets the **same** number. Ten replicas of `frontend` share one identity.

```
 labels {k8s:app=frontend, k8s:io.kubernetes.pod.namespace=shop}  → identity 48211
 labels {k8s:app=orders,   k8s:io.kubernetes.pod.namespace=shop}  → identity 30982
 special/reserved identities: host, world, remote-node, kube-apiserver, health, init, …
```

**Step 2: policy is written over identities.** For each local pod (an "endpoint"), the agent fills a **policy map**: `(identity, port, protocol) → allow/deny`.

```
 policy map for endpoint "orders" (identity 30982), ingress:
   (48211 frontend, TCP, 8080) → ALLOW
   (52001 prometheus, TCP, 9090) → ALLOW
   everything else → DROP
```

**Step 3: the ipcache maps IP → identity.** One map per node (`ipcache`) says which identity each IP in the cluster belongs to.

```
 ipcache:
   10.244.1.5  → 48211   (a frontend pod)
   10.244.3.4  → 48211   (another frontend pod)
   10.244.2.7  → 30982   (orders)
   0.0.0.0/0   → world
```

Now see what happens on pod churn. A new `frontend` replica appears with IP 10.244.5.9:

- **iptables model:** every node that has pods allowing `frontend` updates its ipset/rules.
- **Cilium model:** one new ipcache entry `10.244.5.9 → 48211` is distributed. **No policy map anywhere changes**, because the identity 48211 is already allowed. Only a *new label combination* creates a new identity and touches policy maps.

That's why identity scales: pod IPs churn constantly, but label sets churn rarely.

### 5.3 A packet through Cilium, with policy

frontend (node A) → orders Service → orders pod (node B), with kube-proxy replacement and VXLAN tunnelling:

```
 frontend process: connect(10.96.0.50:80)
   │
   ▼ ① cgroup connect hook (socket-LB)
   │   Service map lookup: 10.96.0.50:80 → backend 10.244.2.7:8080
   │   rewrites the socket's destination BEFORE any packet exists
   │   (no per-packet DNAT, no conntrack entry for the Service)
   ▼
 SYN 10.244.1.5 → 10.244.2.7:8080 leaves the pod
   │
   ▼ ② tc program on frontend's veth (node A) — EGRESS policy for frontend
   │   conntrack lookup: new flow
   │   ipcache: 10.244.2.7 → identity 30982 (orders)
   │   frontend's egress policy map: (30982, TCP, 8080)? → ALLOW
   │   create conntrack entry
   │   destination is on node B → encapsulate; the tunnel header
   │   CARRIES the source identity 48211
   ▼
 ════════ VXLAN/Geneve over the node network ════════
   │
   ▼ ③ node B decapsulates — source identity known from the header
   │   (in native routing mode: look up the source IP in ipcache instead)
   ▼ ④ before delivery to orders' veth — INGRESS policy for orders
   │   orders' ingress policy map: (48211, TCP, 8080)? → ALLOW
   │   conntrack entry created; deliver
   ▼
 orders pod receives the SYN from 10.244.1.5 (no NAT between pods)

 replies: matched by the conntrack entries in ② and ④ → allowed (rule 5)
 drops:   at ② or ④ the program emits an event → visible in Hubble with
          both identities, port, and reason ("Policy denied")
```

Each policy decision is a few hash-map lookups in JIT-compiled code. That's the core of the latency story in section 7.

### 5.4 What Cilium adds beyond NetworkPolicy

Cilium enforces standard `NetworkPolicy` objects, plus its own CRDs: **`CiliumNetworkPolicy`** (namespaced) and **`CiliumClusterwideNetworkPolicy`** (cluster-scoped). It also supports the upstream `ClusterNetworkPolicy` (section 6) from 1.20, behind a flag. The extras, mapped to the gaps in section 2.7:

| Gap in NetworkPolicy | Cilium feature |
|---|---|
| No deny | `ingressDeny` / `egressDeny`. **Deny always wins** over allow, including over plain NetworkPolicies. (Deny rules can't use L7 or FQDN.) |
| No cluster-wide default | `CiliumClusterwideNetworkPolicy` |
| Can't name the node, API server, internet | **entities**: `host`, `remote-node`, `kube-apiserver`, `world`, `cluster`, `ingress`, `health`, `init`, `all` |
| No DNS names | **`toFQDNs`** (`matchName`, `matchPattern: "*.example.com"`) |
| No L7 | HTTP rules (method, path, host, headers) and DNS rules, enforced by Envoy |
| No logging | **Hubble**: every flow and every drop, with identities and verdict |
| Hard to roll out safely | **policy audit mode**: would-be drops are allowed but logged as `AUDITED` |

(Kafka-protocol L7 rules existed in older versions and were **removed in 1.20**; delete them before upgrading.)

Example: let `orders` call only `GET /api/v1/*` on `inventory`, and reach one external API by name:

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata: {name: orders-egress, namespace: shop}
spec:
  endpointSelector:
    matchLabels: {app: orders}
  egress:
    # DNS, with an L7 DNS rule so the DNS proxy sees the lookups (needed for toFQDNs)
    - toEndpoints:
        - matchLabels:
            k8s:io.kubernetes.pod.namespace: kube-system
            k8s:k8s-app: kube-dns
      toPorts:
        - ports: [{port: "53", protocol: ANY}]
          rules:
            dns: [{matchPattern: "*"}]
    # L7 HTTP to another workload
    - toEndpoints:
        - matchLabels: {app: inventory}
      toPorts:
        - ports: [{port: "8080", protocol: TCP}]
          rules:
            http: [{method: GET, path: "/api/v1/.*"}]
    # an external API by DNS name
    - toFQDNs:
        - matchName: api.example.com
      toPorts:
        - ports: [{port: "443", protocol: TCP}]
```

### 5.5 How `toFQDNs` works (and why it needs a DNS rule)

An IP firewall can't match names. Cilium makes it work by watching DNS:

```
 ① orders asks DNS for api.example.com
      │ the L7 DNS rule makes Cilium redirect DNS to its DNS proxy (in the agent)
      ▼
 ② DNS proxy forwards the query to CoreDNS, sees the answer:
      api.example.com → 203.0.113.10, 203.0.113.11   (TTL 60)
 ③ agent maps those IPs to an identity for "api.example.com" and
    adds it to orders' egress policy map, BEFORE returning the answer
 ④ answer returned to the pod
 ⑤ pod connects to 203.0.113.10:443 → policy map says ALLOW
```

The order in ③ matters: the IPs are allowed before the app can use them, so there's no race. The consequences: DNS for those pods goes through the agent's proxy (a dependency to keep healthy), and a pod that skips DNS and connects to a hardcoded IP won't match.

### 5.6 How L7 rules work (and why they cost more)

eBPF at tc sees packets, not HTTP requests. To check a path or method, something has to reassemble the TCP stream and parse it. Cilium uses **Envoy**:

```
 L3/L4 rule:   pod ──► eBPF lookup ──► pod                         (stays in kernel)

 L7 rule:      pod ──► eBPF: "this flow needs L7" ──► redirect to Envoy (user space,
                                                      node-local)
                                                        │ terminates TCP
                                                        │ parses HTTP
                                                        │ allowed? forward on a new
                                                        │ connection : return 403
                                                        ▼
                                                      pod
```

A denied L7 request gets an **HTTP 403** (or DNS `REFUSED`), not a silent drop, which is friendlier for apps. But every byte of that traffic now crosses into user space and back, and Envoy is in the request path (section 7.3).

### 5.7 Enforcement modes, startup and host traffic

- **`policyEnforcementMode`**: `default` (standard Kubernetes semantics: isolated only when selected), `always` (every endpoint deny-by-default even with no policies), `never`.
- **New pods:** a new endpoint carries the reserved identity `init` until its labels are known, and the pod's start is delayed until its identity is resolved. In `default` mode with no `init` rules, traffic is allowed during that window.
- **Host traffic:** Cilium allows ingress from the local host to its pods by default, so kubelet probes work.

---

## 6. Cluster-wide policy: ClusterNetworkPolicy

NetworkPolicy was designed for **app developers** protecting their own namespace. Cluster administrators need something different: "no pod may ever reach the cloud metadata IP", "every namespace is isolated from every other unless it opts in", "monitoring can always scrape everything". Namespaced allow-only rules can't express that, and a namespace owner could undo it.

SIG Network's **network-policy-api** project answers this. Its first attempt was two objects, `AdminNetworkPolicy` and `BaselineAdminNetworkPolicy`. In the `v1alpha2` API (release v0.2.0) they were merged into one cluster-scoped object: **`ClusterNetworkPolicy`** (CNP). ANP/BANP are no longer developed. CNP is still alpha, with beta targeted around late 2026.

### 6.1 Tiers, priorities and three actions

```
 a packet for a selected pod is evaluated top to bottom:

 ┌────────────────────────────────────────────────────────────┐
 │ TIER: Admin    (ClusterNetworkPolicy, tier: Admin)         │
 │   ordered by priority (lower number first)                 │
 │   Accept → allowed, stop.   Deny → dropped, stop.          │
 │   Pass   → skip the rest of this tier, go down             │
 ├────────────────────────────────────────────────────────────┤
 │ NetworkPolicy  (namespaced, owned by app teams)            │
 │   usual semantics; if the pod is isolated and nothing      │
 │   allows it → dropped                                      │
 ├────────────────────────────────────────────────────────────┤
 │ TIER: Baseline (ClusterNetworkPolicy, tier: Baseline)      │
 │   cluster defaults that apps may override with their       │
 │   NetworkPolicies (e.g. "deny cross-namespace by default") │
 ├────────────────────────────────────────────────────────────┤
 │ nothing matched → allowed (no implicit isolation)          │
 └────────────────────────────────────────────────────────────┘
```

- **Admin tier** = guardrails app teams can't override ("Deny egress to 169.254.169.254 for everyone").
- **Pass** = delegate to the namespace owners ("the admin tier has no opinion on this namespace's internal traffic").
- **Baseline tier** = defaults app teams *can* override ("deny everything not otherwise allowed").

Other v1alpha2 details: `Allow` was renamed `Accept`, ports moved into a `protocols` field, and there's a limit of 25 rules/peers. An **FQDN** egress selector (`domainNames`, NPEP-133) is experimental, egress-only and Accept-only: deny-by-name is deliberately excluded because a stale IP list would leak traffic.

Implementations today (versions vary in completeness): kube-network-policies, Calico 3.32+, Antrea 2.7, Cilium 1.20 (behind a flag), Kube-OVN (experimental). Some cloud CNIs ship their own similar-but-different cluster policy CRD. Check which object your plugin actually reads.

---

## 7. Latency and cost: reasoning it out

"Will network policies add latency?" The honest answer is "it depends where the check happens", and you can work it out from first principles. A policy check costs what the data plane has to **do** per packet (or per new connection), plus what the control plane has to **do** per change.

### 7.1 Per-packet cost of an L3/L4 check

```
 data plane                  work per packet (roughly)                        cost
 ─────────────────────────   ───────────────────────────────────────────     ─────────────
 eBPF (Cilium, Calico eBPF,  conntrack lookup + ipcache lookup + policy      tens to a few
  cloud eBPF agents)         map lookup: a handful of hash lookups in        hundred ns
                             JIT-compiled code at tc
 iptables + ipsets           established packets: one `ct state` match.      small; new-flow
                             new flows: walk the pod's chain, ipset           cost grows with
                             hash lookups                                    rule count
 nftables                    set/map lookups                                 small, flat
 L7 via Envoy proxy          leave the kernel, terminate TCP, parse HTTP,    tens of µs to ms,
                             open a new upstream connection, come back       plus throughput
                                                                             and CPU loss
```

Put that next to what a request already costs: a same-zone network round trip in a cloud is typically in the **hundreds of microseconds**, and a request handler is usually **milliseconds**. A few hash lookups costing nanoseconds are far below the noise. That's the main result:

**L3/L4 policy in eBPF adds no latency you can measure at the application level.** Cilium's own benchmarks (old, from the 1.9 era, but the shape still holds) show eBPF data planes reaching node-to-node baseline throughput, and iptables designs losing most in **connection-heavy** tests (TCP_CRR: a new connection per request), which is exactly where per-new-flow rule walking costs.

iptables-based enforcement is also fine on small and medium clusters. It degrades with **scale**: many policies, many endpoints, lots of churn. That shows up mostly as slow **rule programming**, not per-packet latency.

### 7.2 The costs that *do* show up

1. **Control-plane latency (policy propagation).** Between "pod created" or "policy applied" and "kernel updated" there's a gap: the agent has to notice the change, compute, and program. The upstream docs warn that pods may start before their allow rules arrive and so **briefly have no connectivity**, and there's no API to know when enforcement is done. Apps must retry on startup. Cilium holds the pod's start until its identity is resolved, which narrows this but can add a little to pod startup time.
2. **Memory and map limits.** eBPF maps have fixed sizes, set at startup. Cilium's defaults include 512k TCP conntrack entries, 512k ipcache entries and 16k entries per endpoint policy map. Very broad selectors combined with many identities (or many FQDN-derived identities) can fill a policy map, and packets get dropped. iptables has the same problem in a different form: the conntrack table.
3. **The L7 proxy.** This is the real one. Every L7-policied connection detours through a user-space Envoy. One 2025 IEEE Access study measured Cilium holding ~8.9 Gbit/s with complex L3/L4 policy but dropping to ~94 Mbit/s once L7 policy was on in its testbed. Your numbers will differ, but the order-of-magnitude drop is real. Use L7 rules selectively, where the value is worth it.
4. **The DNS proxy for FQDN rules.** DNS for those pods goes through the agent. It adds a small amount to each lookup and makes the agent's health part of your DNS path.
5. **Encryption is a separate cost.** WireGuard/IPsec between nodes (often enabled together with policies) costs CPU and some bytes per packet (60 bytes for IPv4 WireGuard). Don't blame it on policy.

### 7.3 Performance features that come with an eBPF data plane

These aren't policy, but they often come with the switch to Cilium and can make the overall path *faster* than before:

- **kube-proxy replacement + socket-LB**: Service translation at `connect()` time, so no per-packet DNAT or conntrack for Services.
- **eBPF host routing**: skips iptables and parts of the host stack for pod traffic.
- **netkit** (kernel 6.8+ for Cilium, beta): replaces veth; the Cilium docs say it reduces namespace overhead "down to zero". Cilium 1.20's `bpf.datapathMode=auto` picks it when the kernel supports it.
- **BIG TCP**: bigger packets inside the host (up to 192k) for high-throughput nodes.

So the net latency effect of "moving to Cilium and turning on L3/L4 policies" can easily be zero or negative. "Turning on L7 policies everywhere" is the thing to benchmark.

### 7.4 How to measure it yourself

- Compare p50/p99 latency of a real request path before and after, with the same load. The application's own latency histogram is the right instrument.
- `netperf`/`iperf3` between two pods on different nodes: TCP_RR (request/response latency), TCP_CRR (new connection per request, which stresses conntrack and policy-on-new-flow), TCP_STREAM (throughput).
- Watch agent CPU, map pressure (`cilium-dbg map list`, conntrack metrics) and drop counters.
- Check the pod-startup-to-ready time, since that's where propagation cost lands.

---

## 8. Comparing the options

### 8.1 Enforcers

| | Data plane | Policy model | Notable |
|---|---|---|---|
| **Cilium** | eBPF | NetworkPolicy, CNP, Cilium CRDs; identity-based | L7, FQDN, deny, Hubble, kube-proxy replacement; needs kernel ≥ 5.10 |
| **Calico** | iptables, nftables, eBPF, VPP | NetworkPolicy, CNP, Calico CRDs (tiers, deny, global) | Mature, BGP native routing; choose the data plane |
| **Antrea** | Open vSwitch | NetworkPolicy, CNP, Antrea CRDs (tiers, FQDN, L7, logging) | Central controller computes, agents program OVS |
| **Cloud CNI policy agents** (e.g. AWS VPC CNI's network policy agent) | eBPF | NetworkPolicy + a vendor cluster-policy CRD | Keeps the cloud's pod networking; fewer features; check mode (standard vs strict) and limits |
| **kube-network-policies** | nftables + nfqueue | NetworkPolicy, CNP, FQDN (experimental) | SIG Network reference implementation |

### 8.2 Network policy vs service mesh

They solve overlapping but different problems, and they combine well:

| | Network policy (L3/L4) | Service mesh (mTLS + authz) |
|---|---|---|
| Identity | IP → label/identity (trusts the network) | cryptographic (certificates per workload) |
| Granularity | IP, port, protocol (+ L7 in Cilium) | HTTP/gRPC method, path, headers, caller identity |
| Encryption | no (separate feature) | yes, by default |
| Cost | ~free at L3/L4 | proxy hop on every request (sidecar or node proxy) |
| Covers non-HTTP | yes, any TCP/UDP | mostly HTTP/gRPC/TCP |

Think of them as layers: cloud security groups at the node edge, L3/L4 network policy as the always-on baseline between pods, and mesh/L7 authorization where you need request-level rules.

### 8.3 Pros and cons, summed up

**Pros**

- Shrinks blast radius: a compromised pod can only reach what it's allowed to.
- Written in labels, so it follows workloads automatically.
- Declarative and in git, so it's reviewable, auditable, and evidence for compliance.
- L3/L4 enforcement in eBPF is effectively free at runtime.
- Egress control is the only reliable way to limit what a pod can reach outside, since external firewalls only see node IPs.

**Cons**

- Default-deny breaks things in non-obvious ways (DNS, metrics scraping, webhooks, API server access) until you've mapped every flow.
- Upstream NetworkPolicy is limited: allow-only, namespaced, no names, no logging. Real setups need a CNI's extensions or ClusterNetworkPolicy.
- Debugging gets harder: "connection timed out" now has another possible cause. You need flow visibility (Hubble or equivalent) to work sanely.
- Enforcement is asynchronous; apps must tolerate brief startup gaps.
- L7 and FQDN features add real latency and new dependencies (Envoy, DNS proxy).
- It's IP-trust: it doesn't encrypt or cryptographically authenticate anything.

---

## 9. Rolling it out safely

### 9.1 The order that works

```
 ① SEE        turn on flow visibility (Hubble or your CNI's flow logs).
              Collect a week of real flows: who talks to whom, on which port.
                     │
 ② WRITE      write allow policies from the observed flows,
              per namespace, in git. Allow DNS first.
                     │
 ③ AUDIT      apply with audit mode (would-be drops are logged, not dropped)
              or default-deny in a staging copy. Fix the misses.
                     │
 ④ ENFORCE    default-deny one namespace at a time, least critical first.
              Watch drop events and error rates.
                     │
 ⑤ GUARDRAIL  cluster-wide rules: block metadata IP, baseline
              cross-namespace deny, always-allow monitoring.
```

### 9.2 The things that break first

1. **DNS.** Default-deny egress blocks DNS. Allow egress to the DNS pods on **UDP and TCP 53** (TCP is used for large answers). In some setups you also need the NodeLocal DNSCache IP.
2. **The Kubernetes API server.** Operators, controllers and anything using a ServiceAccount token call it. It's not a pod (it's an external IP or the `kubernetes` Service's endpoints), so NetworkPolicy needs an `ipBlock` for it; Cilium has the `kube-apiserver` entity.
3. **Admission webhooks.** The API server calls webhook pods. Their ingress must allow the control plane's source addresses, or `kubectl apply` starts failing cluster-wide.
4. **Metrics scraping.** Prometheus needs ingress to every metrics port.
5. **Cloud metadata / credentials.** Pods that get credentials from the instance metadata endpoint need egress to it; pods that shouldn't, should be blocked from it.
6. **hostNetwork pods** can't be selected by pod/namespace selectors (they look like the node). Match them with `ipBlock`.
7. **Existing connections.** Whether a new policy cuts already-open connections is "implementation defined". Test a policy change against long-lived connections (database pools, gRPC streams) rather than assuming.
8. **Named ports and Service ports.** Policies match the pod's port (`targetPort`), not the Service port.

### 9.3 Debugging cheatsheet

```bash
# What policies select this pod, and how was the YAML parsed?
kubectl get networkpolicy -n shop
kubectl describe networkpolicy orders-ingress -n shop

# Cilium: live drops with reason, identities and ports
hubble observe --verdict DROPPED -n shop
hubble observe --from-label app=frontend --to-label app=orders

# Cilium: per-node view
kubectl -n kube-system exec ds/cilium -- cilium-dbg endpoint list
kubectl -n kube-system exec ds/cilium -- cilium-dbg policy get
kubectl -n kube-system exec ds/cilium -- cilium-dbg monitor --type drop
kubectl -n kube-system exec ds/cilium -- cilium-dbg identity list

# Raw eBPF state on a node
bpftool prog show
bpftool map show

# iptables/ipset-based plugins
iptables-save | grep -i <pod-veth-or-chain>
ipset list
```

The quick test for "is it policy?": temporarily add an allow-all policy for the pod in a test environment, or check the drop log. If the drop log is empty and it still fails, it's not policy: go back to the layer-by-layer checklist in part 1.

---

## 10. Glossary

- **NetworkPolicy**: namespaced, allow-only L3/L4 rules for pods (`networking.k8s.io/v1`).
- **Isolated (pod)**: selected by a policy for a direction; deny-by-default in that direction.
- **ClusterNetworkPolicy (CNP)**: cluster-scoped admin policy with tiers, priorities and Accept/Deny/Pass (`v1alpha2`).
- **eBPF**: verified, JIT-compiled programs loaded into the running kernel at hooks.
- **Verifier**: the kernel component that proves an eBPF program is safe before it runs.
- **Map**: a kernel key-value store shared by eBPF programs and user space.
- **XDP / tc / tcx / cgroup hooks / netkit**: where networking eBPF programs attach.
- **Security identity** (Cilium): a number for a set of labels; the unit policy is written in.
- **ipcache** (Cilium): map from IP/CIDR to identity.
- **Endpoint** (Cilium): one pod's network presence on a node, with its own policy map.
- **Entity** (Cilium): a reserved peer like `world`, `host`, `kube-apiserver`.
- **toFQDNs**: Cilium egress rules by DNS name, implemented by watching DNS answers.
- **Hubble**: Cilium's flow observability layer.
- **Audit mode**: would-be drops are allowed and logged, for safe rollout.

**One-line summary:** a flat pod network needs a firewall that's written in labels and enforced at each pod's interface; NetworkPolicy is the allow-only, per-namespace API for it, and the CNI enforces it; eBPF makes that enforcement a few hash lookups in the kernel, so L3/L4 policy costs essentially nothing at runtime; Cilium adds identities, deny, FQDN, L7 and visibility on top. Pay for L7 only where you need it, and roll out by observing first, auditing, then enforcing namespace by namespace.

---

### Sources

- Kubernetes: [Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/) (written as of v1.37), [Declare Network Policy](https://kubernetes.io/docs/tasks/administer-cluster/declare-network-policy/)
- network-policy-api: [project site](https://network-policy-api.sigs.k8s.io/), [API overview](https://network-policy-api.sigs.k8s.io/api-overview/), [implementations](https://network-policy-api.sigs.k8s.io/implementations/), [v1alpha2: ClusterNetworkPolicy replaces ANP/BANP](https://network-policy-api.sigs.k8s.io/blog/2025/10/09/api-update-for-v1alpha2-clusternetworkpolicy-replaces-adminnetworkpolicy-and-baselineadminnetworkpolicy/), [NPEP-133 FQDN egress](https://network-policy-api.sigs.k8s.io/npeps/npep-133-fqdn-egress-selector/), [releases](https://github.com/kubernetes-sigs/network-policy-api/releases)
- eBPF: [What is eBPF](https://ebpf.io/what-is-ebpf/), [kernel verifier docs](https://docs.kernel.org/bpf/verifier.html), [tc/tcx program type](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/), [LWN: netkit](https://lwn.net/Articles/949960/)
- Cilium docs (1.20): [eBPF datapath intro](https://docs.cilium.io/en/stable/network/ebpf/intro/), [eBPF maps](https://docs.cilium.io/en/stable/network/ebpf/maps/), [Identity](https://docs.cilium.io/en/stable/security/network/identity/), [Policy intro and enforcement modes](https://docs.cilium.io/en/stable/security/policy/intro/), [L3 policy and entities](https://docs.cilium.io/en/stable/security/policy/layer3/), [L7 policy](https://docs.cilium.io/en/stable/security/policy/layer7/), [Deny policies](https://docs.cilium.io/en/stable/security/policy/deny/), [Policy creation and audit mode](https://docs.cilium.io/en/stable/security/policy-creation/), [Endpoint lifecycle](https://docs.cilium.io/en/stable/security/policy/lifecycle/), [Caveats](https://docs.cilium.io/en/stable/security/policy/caveats/), [kube-proxy replacement](https://docs.cilium.io/en/stable/network/kubernetes/kubeproxy-free/), [System requirements](https://docs.cilium.io/en/stable/operations/system_requirements/), [Performance tuning](https://docs.cilium.io/en/stable/operations/performance/tuning/), [Benchmark](https://docs.cilium.io/en/stable/operations/performance/benchmark/), [Upgrade notes](https://docs.cilium.io/en/stable/operations/upgrade/), [Envoy proxy](https://docs.cilium.io/en/stable/security/network/proxy/envoy/), [Hubble](https://docs.cilium.io/en/stable/observability/hubble/)
- Cilium releases: [v1.20.0](https://github.com/cilium/cilium/releases/tag/v1.20.0), [Isovalent: Cilium 1.20](https://isovalent.com/blog/post/cilium-1-20/), [CNCF project page](https://www.cncf.io/projects/cilium/)
- Other enforcers: [Calico release notes](https://docs.tigera.io/calico/latest/release-notes/), [Calico eBPF](https://docs.tigera.io/calico/latest/operations/ebpf/), [AWS VPC CNI network policy](https://docs.aws.amazon.com/eks/latest/userguide/cni-network-policy.html), [Antrea architecture](https://antrea.io/docs/main/docs/design/architecture/), [Antrea-native policy](https://antrea.io/docs/main/docs/antrea-network-policy/), [kube-network-policies](https://kube-network-policies.sigs.k8s.io/)
- Performance: [Kubernetes blog: NFTables mode for kube-proxy](https://kubernetes.io/blog/2025/02/28/nftables-kube-proxy/); Kim, Kim and Lee, "Exploring Security Enhancements in Kubernetes CNI", IEEE Access 2025, DOI [10.1109/ACCESS.2025.3543841](https://doi.org/10.1109/ACCESS.2025.3543841) (numbers taken from the abstract)
- Further reading: Isovalent, [Cilium netkit](https://isovalent.com/blog/post/cilium-netkit-a-new-container-networking-paradigm-for-the-ai-era/); LPC 2023, [tcx and netkit](https://lpc.events/event/17/contributions/1581/); DNS over TCP: [RFC 7766](https://www.rfc-editor.org/rfc/rfc7766)
