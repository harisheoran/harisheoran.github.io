---
title: Kubernetes Networking
date: 2026-10-29
draft: false
description: "How a packet actually moves in Kubernetes, built up from Linux primitives: namespaces, veth, routes, netfilter, CNI, Services, DNS"
categories: ["networking"]
tags: ["k8s", "linux", "cni"]
---
Kubernetes networking feels like magic until you notice that Kubernetes itself moves **zero packets**. Every packet is moved by the ordinary Linux kernel, using the same primitives a sysadmin used in 2010: network namespaces, virtual cables, routing tables and netfilter rules. Kubernetes only writes down **what** should be reachable. Plug-ins (the CNI plugin and kube-proxy, or a replacement such as Cilium) turn that into kernel configuration.

So the way to understand it is bottom-up: first the Linux pieces, then the rules Kubernetes sets, then how each kind of traffic flows. This note ends where **network policies** start. Policy is just one more check placed on the packet paths described here, so you need the paths first. Part 2 is [Kubernetes Network Policies, eBPF and Cilium](../kubernetes-network-policies/).

This note is written against **Kubernetes v1.37 (August 2026)**, the latest stable release.

---

## 1. The problem

You have many machines. On them run thousands of short-lived processes (containers) that need to talk to each other. They get created, killed and rescheduled onto other machines all day.

Three things make this hard:

```
  1. ADDRESSING   Who gets which IP? Two containers on one machine
                  must not both want port 8080 on the same IP.

  2. REACHABILITY How does a packet from a container on machine A
                  find a container on machine B, when the physical
                  network only knows about machines A and B?

  3. CHURN        Containers die and come back with NEW IPs. Clients
                  need a name/IP that stays the same anyway.
```

Plain Docker on one host solved (1) by giving each container a private IP behind the host's IP and NAT, with port mapping (`-p 8080:80`). That falls apart across many hosts: every container sees a different address for its peer than the peer sees for itself, and port allocation becomes a cluster-wide scheduling problem.

Kubernetes chose a different contract, and everything else follows from it.

---

## 2. The Kubernetes network model (the contract)

The current docs state the model in a few sentences:

1. **Every pod gets its own unique, cluster-wide IP address.**
2. Containers inside one pod share that IP and talk over `localhost`.
3. **All pods can reach all other pods, on the same node or on different nodes, directly, without proxies or NAT** ("barring intentional network segmentation", which is what network policies are).
4. Agents on a node (kubelet, system daemons) can reach all pods on that node.

Then two more pieces sit on top:

5. **Services** give a stable IP and DNS name in front of a changing set of pods.
6. **Gateway API** (or the older Ingress) brings traffic in from outside.

Read rule 3 carefully. "Without NAT" means that when pod A (10.0.1.5) talks to pod B (10.0.2.7), B sees the packet arriving **from 10.0.1.5**. The IP a pod sees for itself is the IP everyone else sees for it. That one property is what lets a pod IP work like a VM's IP. It is also what makes IP-based firewalling (network policy) possible at all.

Kubernetes **specifies** this model but does not **implement** it. The implementation is split:

```
┌─────────────────────────────────────────────────────────────────────┐
│ The problem              │ Who solves it                            │
├──────────────────────────┼──────────────────────────────────────────┤
│ container ↔ container    │ Linux: shared network namespace          │
│ pod ↔ pod                │ CNI plugin (Calico, Cilium, cloud CNIs…) │
│ pod ↔ Service            │ kube-proxy (or an eBPF replacement)      │
│ name → Service IP        │ CoreDNS                                  │
│ outside → Service        │ cloud load balancer + Gateway/Ingress    │
│ "who may talk to whom"   │ NetworkPolicy, enforced by the CNI       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. The Linux building blocks

Five kernel features do all the work. Learn them once and every CNI becomes readable.

### 3.1 Network namespace: a private copy of the network stack

A network namespace (netns) is an isolated copy of everything network-related: interfaces, IP addresses, routing table, ARP table, netfilter rules, and the port space.

```
          one Linux kernel
┌───────────────────────────────────────────────────────┐
│  root netns (the host)       netns "pod-a"            │
│  ┌────────────────────┐      ┌────────────────────┐   │
│  │ eth0 10.0.0.11     │      │ eth0 10.244.1.5    │   │
│  │ lo                 │      │ lo                 │   │
│  │ routes, iptables   │      │ own routes         │   │
│  │ port 8080 → nginx  │      │ port 8080 → app    │   │ ← no conflict
│  └────────────────────┘      └────────────────────┘   │
└───────────────────────────────────────────────────────┘
```

This is why two pods on one node can both listen on 8080: they're in different namespaces, so they have different port spaces.

A **pod is exactly one network namespace.** When a pod starts, the runtime first creates a tiny "pause" (sandbox) container that just holds the namespace open. The app containers then join it. That's why containers in a pod share an IP and see each other on `localhost`, and why restarting an app container doesn't change the pod's IP.

You can play with this on any Linux box:

```bash
ip netns add demo
ip netns exec demo ip addr          # only "lo", and it's DOWN
```

### 3.2 veth pair: a virtual cable

A new namespace has no way out. A **veth pair** is two virtual interfaces joined like the two ends of a cable: whatever goes in one end comes out the other. Put one end inside the pod's namespace (renamed `eth0`) and leave the other end in the host namespace (named something like `vethab12cd` or `lxc12ab`).

```
   pod-a netns                     root netns
  ┌────────────┐                 ┌──────────────┐
  │   eth0     │═════════════════│  veth1a2b    │
  │ 10.244.1.5 │   veth pair     │  (no IP)     │
  └────────────┘                 └──────────────┘
```

Now the packet can leave the pod. Something on the host side has to decide where it goes next.

### 3.3 Bridge or routes: the host-side switch

Two common ways to connect the host ends:

**Option A: a Linux bridge** (a virtual L2 switch, e.g. `cni0`). All the host ends plug into it. Pods on the same node are on one L2 segment and find each other with ARP. The bridge has an IP and acts as the pods' default gateway. The classic `bridge` CNI plugin and flannel work this way.

```
  pod-a eth0 ─veth─┐
                   ├── cni0 bridge (10.244.1.1) ── host routing ── eth0
  pod-b eth0 ─veth─┘
```

**Option B: pure L3 routing, no bridge.** The host has one `/32` route per local pod pointing at its veth. Inside the pod, the default route points to a fake link-local gateway (often 169.254.1.1), and either the host answers ARP for it (proxy ARP) or a static ARP entry in the pod points it at the host end of the veth. Calico and the AWS VPC CNI work this way; Cilium is similar but often skips the routing table entirely with eBPF.

```
host routing table:
  10.244.1.5  dev veth1a2b  scope link
  10.244.1.6  dev veth3c4d  scope link
```

Routing is simpler to reason about and gives one clear L3 hop where policy can be enforced.

### 3.4 The routing table

Each namespace has its own. The kernel picks the **longest prefix match** for the destination and sends the packet out that interface, maybe via a next-hop gateway. That's all routing is. For cross-node traffic, someone has to put "10.244.2.0/24 lives on node B" into a routing table somewhere (section 5).

### 3.5 Netfilter, iptables/nftables and conntrack

**Netfilter** is a set of hooks inside the kernel's packet path. Code (rules) attached to a hook sees every packet that passes it:

```
            incoming packet
                  │
            ┌─────▼──────┐
            │ PREROUTING │  ← DNAT happens here (Service IP → pod IP)
            └─────┬──────┘
                  │ routing decision: for me, or forward?
         ┌────────┴─────────┐
         ▼                  ▼
     ┌───────┐         ┌─────────┐
     │ INPUT │         │ FORWARD │  ← pod-to-pod traffic through the host
     └───┬───┘         └────┬────┘    passes here (filtering)
         ▼                  │
   local process            │
         │                  │
     ┌───▼────┐             │
     │ OUTPUT │  ← DNAT for traffic from host processes
     └───┬────┘             │
         └─────────┬────────┘
             ┌─────▼───────┐
             │ POSTROUTING │  ← SNAT / masquerade happens here
             └─────┬───────┘
                   ▼
              out the interface
```

**iptables** and its successor **nftables** are the user-space tools that program rules into those hooks. iptables rules sit in linear chains, checked one by one. nftables adds sets and maps, so one lookup can replace thousands of rules.

**conntrack** (connection tracking) records every flow it sees: `(proto, src IP, src port, dst IP, dst port)` plus state. Two consequences matter a lot here:

- **NAT is decided once per connection.** The first packet is NATed by the rules. The kernel stores the translation in the conntrack entry, and every later packet, including replies, is translated from that entry without consulting the rules again. This is how a reply from a pod gets its source rewritten back to the Service IP.
- **Stateful filtering.** A firewall can say "allow replies to connections I allowed" (`ct state established,related accept`). Network policies rely on this: you write a rule for the request direction only.

The conntrack table is finite (`nf_conntrack_max`). When it fills, new connections are dropped with `nf_conntrack: table full, dropping packet` in `dmesg`. Busy nodes with lots of short connections, especially UDP DNS, hit this.

### 3.6 Encapsulation (tunnels)

Wrap a whole packet inside another packet whose outer addresses the physical network does understand. VXLAN puts the original Ethernet frame inside a UDP packet (UDP 8472 in Cilium and flannel; 4789 is the IANA port). Geneve is a newer, extensible version of the same idea (UDP 6081). More in section 5.

---

## 4. Inside one node

### 4.1 Container to container (same pod)

Same netns, so it's just `localhost`. No packet ever leaves the namespace. Two containers in one pod can't both bind the same port.

### 4.2 Pod to pod on the same node

```
 node A
┌──────────────────────────────────────────────────────────┐
│  pod-a (10.244.1.5)                  pod-b (10.244.1.6)  │
│  ┌──────────┐                          ┌──────────┐      │
│  │  eth0    │                          │  eth0    │      │
│  └────┬─────┘                          └────▲─────┘      │
│       │ ①                                   │ ④          │
│  ┌────▼─────┐   ② route lookup:        ┌────┴─────┐      │
│  │ veth-a   │──► 10.244.1.6 →  ───────►│ veth-b   │      │
│  └──────────┘   dev veth-b  ③ FORWARD  └──────────┘      │
│                  (bridge or /32 route)  hook (policy)    │
└──────────────────────────────────────────────────────────┘
```

1. pod-a sends to 10.244.1.6. Its only route is the default, so it goes out `eth0`, which is the veth into the host.
2. The host namespace receives it on `veth-a` and looks up 10.244.1.6: either the bridge forwards it at L2, or a `/32` route points to `veth-b`.
3. The packet passes the host's netfilter hooks (FORWARD). **This is a natural place to enforce policy.**
4. It goes out `veth-b` and appears on pod-b's `eth0`.

No NAT. pod-b sees source 10.244.1.5.

### 4.3 Node to pod

Kubelet's health probes come from the host network namespace, so they arrive at the pod from the **node's IP**. Remember this for part 2: the NetworkPolicy spec says traffic between a pod and its own node is always allowed, which is why a default-deny ingress policy doesn't break liveness and readiness probes. Pods with `hostNetwork: true` share the node's namespace and IP, so they look like "the node" too.

---

## 5. Across nodes: three ways to make pod IPs routable

Node A (10.0.0.11) has pods in 10.244.1.0/24. Node B (10.0.0.12) has pods in 10.244.2.0/24. The physical/cloud network only knows about 10.0.0.0/16. A packet to 10.244.2.7 leaving node A has to get to node B somehow. There are exactly three families of answer.

### 5.1 Overlay (encapsulation)

Wrap the pod packet in a node-to-node packet.

```
 pod-a 10.244.1.5                                         pod-c 10.244.2.7
      │                                                          ▲
      ▼                                                          │
 ┌──────────── node A ────────────┐       ┌──────────── node B ──┴──────────┐
 │ route: 10.244.2.0/24 → vxlan0  │       │ vxlan0 strips outer headers     │
 │ vxlan0 wraps:                  │       │ inner dst 10.244.2.7 → veth-c   │
 │ ┌────────────────────────────┐ │       │                                 │
 │ │outer IP 10.0.0.11→10.0.0.12│ │       │                                 │
 │ │outer UDP dport 8472        │ │ ────► │                                 │
 │ │VXLAN hdr (VNI)             │ │       │                                 │
 │ │inner Eth                   │ │       │                                 │
 │ │inner IP 10.244.1.5→.2.7    │ │       │                                 │
 │ │payload                     │ │       │                                 │
 │ └────────────────────────────┘ │       │                                 │
 └────────────────────────────────┘       └─────────────────────────────────┘
```

- **Pro:** works on any network that can route node IPs. No cooperation from the underlay.
- **Con:** extra bytes and CPU on every packet. IPv4 VXLAN adds **50 bytes** (inner Ethernet 14 + VXLAN 8 + UDP 8 + outer IPv4 20). On a 1500-byte network, pod MTU must drop to **1450**, otherwise packets get fragmented or silently dropped (the classic "small requests work, big responses hang" bug). On a 9001-byte jumbo network it's 8951.
- **Con:** the underlay (and its flow logs) sees only node-to-node UDP. You lose per-pod visibility outside the cluster.

Encapsulation overhead per Calico's MTU table:

| Encapsulation | Header bytes | Pod MTU on a 1500 network |
|---|---|---|
| IPv4 VXLAN | 50 | 1450 |
| IPv6 VXLAN | 70 | 1430 |
| IP-in-IP | 20 | 1480 |
| WireGuard IPv4 | 60 | 1440 |
| WireGuard IPv6 | 80 | 1420 |

### 5.2 Native routing (no encapsulation)

Teach the network where each node's pod CIDR lives, and send pod packets unwrapped.

- On a flat L2 network, each node just adds `10.244.2.0/24 via 10.0.0.12` (flannel `host-gw`, Cilium `autoDirectNodeRoutes`).
- On a routed network, nodes announce their pod CIDRs with **BGP** to the top-of-rack routers (Calico's classic mode, Cilium BGP control plane).
- In a cloud, the plugin writes entries into the VPC route table.

```
 node A routing table:
   10.244.1.0/24  local pods
   10.244.2.0/24  via 10.0.0.12      ← learned via BGP or installed by the CNI
```

- **Pro:** no header overhead, full MTU, the network sees real pod IPs.
- **Con:** the underlay must cooperate. Cloud route tables have size limits.

### 5.3 Pods get real network IPs (cloud-native CNI)

The cloud network itself hands out the pod IPs. The AWS VPC CNI, for example, attaches extra ENIs (virtual NICs) to each node and assigns real VPC IPs (or /28 prefixes, with prefix delegation) to pods. The VPC fabric already knows where every one of those IPs lives, so nothing extra is needed.

```
 VPC 10.0.0.0/16
   node A  ENI-1 10.0.0.11    ENI-2: 10.0.4.20, 10.0.4.21, 10.0.4.22 → pods
   node B  ENI-1 10.0.0.12    ENI-2: 10.0.5.30, 10.0.5.31            → pods
```

- **Pro:** no overlay, no routes to manage, pod IPs work everywhere in the VPC (security groups, flow logs, peered networks).
- **Con:** you spend real VPC IP space on every pod, and pod density per node is capped by how many ENIs/IPs the instance type supports.

### 5.4 Which one, from first principles

Ask one question: **can the network between nodes route pod IPs?**

- No, and you can't change it → overlay.
- Yes, and you control the routers/route tables → native routing.
- The cloud network can allocate IPs for you and you can afford the address space → cloud-native IPs.

---

## 6. CNI: the contract between Kubernetes and the plugin

The **Container Network Interface** is a deliberately tiny spec (current spec version **1.1.0**). A CNI plugin is just an **executable binary** on the node. The container runtime runs it with:

- environment variables (`CNI_COMMAND=ADD`, `CNI_NETNS=/var/run/netns/...`, `CNI_IFNAME=eth0`, …),
- the network config as JSON on stdin,
- and reads the result (IPs, routes, DNS) as JSON on stdout.

The verbs:

| Verb | What it does |
|---|---|
| `ADD` | Plug this container into the network: create the veth, assign an IP, add routes. |
| `DEL` | Unplug. Best effort, must be safe to run twice. |
| `CHECK` | Is the attachment still what `ADD` returned? |
| `STATUS` | (spec 1.1) Is the plugin ready to accept `ADD`? |
| `GC` | (spec 1.1) Here's the list of valid attachments; clean up anything leaked, e.g. IPAM leases. |
| `VERSION` | Which spec versions do you support? |

Who calls whom when a pod is scheduled:

```
 kube-scheduler  ── binds pod to node B
        │
        ▼
 kubelet (node B) ── CRI: RunPodSandbox ──► containerd / CRI-O
                                                  │
                                                  │ 1. create netns + pause container
                                                  │ 2. exec CNI plugin: ADD
                                                  ▼
                                    /opt/cni/bin/<plugin>  (config in /etc/cni/net.d/)
                                                  │
                          ┌───────────────────────┼─────────────────────────┐
                          ▼                       ▼                         ▼
                   create veth pair        IPAM plugin: pick IP      add routes / attach
                   move one end into netns from the node's range     eBPF programs, etc.
                                                  │
                                                  ▼
                              result {ips, routes} ──► runtime ──► kubelet
                                                         reports podIP in pod status
```

Note that **kubelet does not call CNI itself**. Since 1.24 the runtime owns it.

**IPAM** (IP address management) is usually a separate, chained plugin: `host-local` hands out IPs from the node's pod CIDR (`node.spec.podCIDR`), while cloud CNIs allocate from the VPC.

Big CNIs (Calico, Cilium, cloud CNIs) are more than the binary: they run a **per-node agent (DaemonSet)** that watches the API server for pods, Services and policies and keeps the kernel state in sync. The binary handles the moment of pod creation; the agent handles everything after.

---

## 7. Services: a stable address for a moving target

### 7.1 The problem

Pods die. A Deployment's three replicas might be 10.244.1.5, 10.244.2.7, 10.244.3.9 today and three different IPs tomorrow. Clients need one address that stays the same and spreads load.

### 7.2 The trick: a virtual IP that exists on no interface

A ClusterIP Service gets an IP from the Service CIDR, say 10.96.0.50. **No interface anywhere has this IP. Nothing listens on it. You can't ping it** (ICMP to it usually goes nowhere). It's only a match pattern: every node has rules saying "a packet to 10.96.0.50:80 should be rewritten to one of these pod IPs".

```
 Service "orders"  ClusterIP 10.96.0.50:80  selector app=orders
        │
        │ endpoints controller watches pods matching the selector
        ▼
 EndpointSlice "orders-x7k2"   (ready pod IPs + ports, up to 100 per slice)
   10.244.1.5:8080  ready
   10.244.2.7:8080  ready
   10.244.3.9:8080  not ready (failing readiness probe)
        │
        │ kube-proxy on EVERY node watches Services + EndpointSlices
        ▼
 kernel rules on every node: 10.96.0.50:80 → {10.244.1.5:8080, 10.244.2.7:8080}
```

Readiness probes matter here: an unready pod is removed from the slice, so it stops getting traffic.

### 7.3 The packet's journey to a Service

pod-a (node A) calls `10.96.0.50:80`:

```
 pod-a 10.244.1.5:51000 ──► dst 10.96.0.50:80
          │
          ▼  node A, PREROUTING / kube-proxy rules
 ┌──────────────────────────────────────────────────────────────┐
 │ match dst 10.96.0.50:80 → pick a backend (random)            │
 │ DNAT dst → 10.244.2.7:8080                                   │
 │ conntrack stores: orig 10.244.1.5:51000→10.96.0.50:80        │
 │                   reply 10.244.2.7:8080→10.244.1.5:51000     │
 └──────────────────────────────────────────────────────────────┘
          │  now an ordinary pod-to-pod packet (section 5)
          ▼
 pod-c 10.244.2.7:8080 sees src 10.244.1.5  (client IP preserved)
          │
          │ reply: src 10.244.2.7:8080 → dst 10.244.1.5:51000
          ▼  back on node A, conntrack matches the entry
 rewrite src → 10.96.0.50:80
          ▼
 pod-a sees the reply coming from the Service IP it called. 
```

Two key facts:

- **Load balancing happens on the client's node, once per connection.** It's not a proxy in the middle. With long-lived connections (gRPC, HTTP/2, database pools), all requests on that connection go to the same pod. Kubernetes Services balance **connections**, not requests.
- **After DNAT, the packet is addressed to a pod IP.** So anything downstream, including network policy on the destination, sees `10.244.1.5 → 10.244.2.7:8080`, never the Service IP. You write policies about pods and ports, not Services.

### 7.4 kube-proxy's data planes

kube-proxy is a controller on every node that turns Services + EndpointSlices into kernel rules. The kernel mechanism it uses is the "mode":

**iptables mode (still the default on Linux in v1.37).** Chains like:

```
KUBE-SERVICES
  -d 10.96.0.50/32 -p tcp --dport 80   -j KUBE-SVC-ORDERS
  -d 10.96.0.51/32 -p tcp --dport 443  -j KUBE-SVC-PAYMENTS
  ... one rule per Service port, checked IN ORDER ...

KUBE-SVC-ORDERS
  -m statistic --mode random --probability 0.5  -j KUBE-SEP-AAA
                                                -j KUBE-SEP-BBB
KUBE-SEP-AAA
  -p tcp -j DNAT --to-destination 10.244.1.5:8080
```

The weakness is in the shape. The first packet of every connection walks `KUBE-SERVICES` linearly, so its cost grows **O(number of Services)**. Any change rewrites the whole table under a global lock, also O(total Services). At thousands of Services both start to hurt.

**IPVS mode.** Used the kernel's L4 load balancer with hash tables. Faster lookups, but it never fit Services well and still needed iptables for parts of the job. **Deprecated in v1.35**, disabled by default from v1.40, removal planned for v1.43. Don't pick it for anything new.

**nftables mode (GA in v1.33, needs kernel ≥ 5.13).** One verdict-map lookup per packet instead of a linear walk, so per-packet cost stays roughly **flat** as Services grow, and updates only touch what changed. The Kubernetes blog's benchmark: at 5,000 and 10,000 Services, nftables' median latency matches iptables' best 1%; at 30,000 Services, nftables' p99 beats iptables' p01. The default is planned to switch to nftables around v1.40. You set it with `mode: nftables` in the kube-proxy config.

```
 iptables:  dst? ─► rule1 ─► rule2 ─► rule3 ─► … ─► rule N ─► match    O(n)
 nftables:  dst? ─► map{ 10.96.0.50:80 → svc-orders, … } ─► match       O(1)
```

**No kube-proxy at all: eBPF.** Cilium (and Calico's eBPF dataplane) can replace kube-proxy. They do the Service translation with eBPF hash maps, often at the socket level: when the app calls `connect(10.96.0.50:80)`, the address is rewritten to the pod IP **before a packet even exists**, so there's no per-packet DNAT and no conntrack entry for it. Part 2 explains this.

### 7.5 Service types

```
 ExternalName  → DNS CNAME only, no IP, no proxying
 Headless      → clusterIP: None; DNS returns the pod IPs directly, no VIP
 ClusterIP     → virtual IP inside the cluster (default)
   └─ NodePort      → ClusterIP + port 30000–32767 open on EVERY node's IP
        └─ LoadBalancer → NodePort + a cloud LB in front, pointed at the nodes
                          (or directly at pod IPs, with cloud CNIs + LB controllers)
```

Headless Services are what StatefulSets use: `db-0.db.ns.svc.cluster.local` resolves straight to one pod.

### 7.6 Which endpoints may be used: traffic policies

| Field | Values | Effect |
|---|---|---|
| `internalTrafficPolicy` | `Cluster` (default) / `Local` | `Local`: in-cluster callers only use endpoints on their own node; **dropped** if none. |
| `externalTrafficPolicy` | `Cluster` (default) / `Local` | `Cluster`: any node accepts and may forward to another node, so the source IP gets SNATed to the node (client IP lost). `Local`: only nodes with a local pod accept (LB health-checks `:10256/healthz`), no second hop, **client IP preserved**. |
| `trafficDistribution` | `PreferSameNode` (stable 1.35) / `PreferSameZone` | A preference, not a rule: same node → same zone → anywhere. Cuts cross-zone cost and latency. `PreferClose` is the deprecated old name for `PreferSameZone`. |

The `externalTrafficPolicy` trade-off is worth understanding, because it decides whether IP-based policies and logs see real client IPs:

```
 externalTrafficPolicy: Cluster
   client 203.0.113.9 ─► LB ─► node A (no pod here)
                                │ SNAT src → node A IP, forward
                                ▼
                             node B pod sees src = node A   ✗ client IP lost

 externalTrafficPolicy: Local
   client 203.0.113.9 ─► LB ─► only nodes that HAVE a pod pass the health check
                             ─► node B pod sees src = 203.0.113.9  ✓
```

---

## 8. DNS: names for Services

### 8.1 How it works

**CoreDNS** runs as a Deployment behind a Service (traditionally named `kube-dns`, e.g. 10.96.0.10). It watches Services and EndpointSlices and answers:

```
 orders.shop.svc.cluster.local      → 10.96.0.50      (ClusterIP)
 db.shop.svc.cluster.local          → pod IPs         (headless)
 _http._tcp.orders.shop.svc...      → SRV records
```

Kubelet writes each pod's `/etc/resolv.conf` (default `dnsPolicy: ClusterFirst`):

```
nameserver 10.96.0.10
search shop.svc.cluster.local svc.cluster.local cluster.local
options ndots:5
```

So inside namespace `shop`, `orders` resolves via the first search domain, and `orders.billing` resolves via the second.

### 8.2 The `ndots:5` tax

`ndots:5` means: **if the name has fewer than 5 dots, try every search domain first, then the name as-is.** `api.example.com` has 2 dots, so a lookup goes:

```
 api.example.com.shop.svc.cluster.local   → NXDOMAIN
 api.example.com.svc.cluster.local        → NXDOMAIN
 api.example.com.cluster.local            → NXDOMAIN
 (+ any search domains inherited from the node, e.g. the cloud's internal one)
 api.example.com                          → answer
```

…and many resolvers do this for **both** A and AAAA. One external lookup becomes 8–10 queries to CoreDNS. Fixes: use a fully-qualified name with a trailing dot (`api.example.com.`), lower `ndots` per pod through `dnsConfig.options`, or cache close to the pod.

### 8.3 Why DNS is fragile, and NodeLocal DNSCache

DNS is UDP and goes through the Service DNAT + conntrack path from section 7. Two classic problems:

- A known race in conntrack when a client sends the A and AAAA queries in parallel from the same socket: one gets dropped and the app waits for the **5-second** resolver timeout.
- Thousands of short UDP flows fill the conntrack table.

**NodeLocal DNSCache** runs a caching DNS agent on every node (DaemonSet) on a link-local IP. Pods query it directly, skipping DNAT and conntrack, and it talks to CoreDNS over TCP. Most "random 5 s latency" DNS problems disappear.

DNS will matter again in part 2: **a default-deny egress policy blocks DNS unless you explicitly allow it**, and it's the first thing that breaks.

---

## 9. Traffic in and out of the cluster

### 9.1 Ingress (outside → in)

Layers, from the outside in:

```
 client
   │
   ▼
 cloud L4/L7 load balancer   (created by a Service type=LoadBalancer
   │                          or a Gateway / Ingress controller)
   ▼
 Gateway / Ingress controller pods   (Envoy, NGINX, … : TLS, host/path routing)
   │
   ▼
 Service ─► pods
```

- **Ingress** is GA but frozen: no new features. **Gateway API** is its successor (v1.6 is current; TCPRoute and UDPRoute reached v1 in 1.6) and splits ownership into GatewayClass (infra provider), Gateway (platform team) and HTTPRoute (app team).
- The community **ingress-nginx** controller was retired in March 2026 and its repository is archived. New setups should use a Gateway API implementation.

### 9.2 Egress (in → outside)

Pod IPs are usually private, so pod traffic leaving the cluster gets **SNATed (masqueraded) to the node's IP** in POSTROUTING, then maybe again by a NAT gateway.

```
 pod 10.244.1.5 ─► node SNAT → 10.0.0.11 ─► NAT gateway → public IP ─► internet
```

Consequence for security: **outside the cluster, every pod on a node looks like the node.** An external firewall can't tell your payment service from your log shipper. That's one reason egress control has to happen **inside** the cluster, at the pod, which is what egress network policy (and features like Cilium's egress gateway) do.

---

## 10. The full journey: `curl http://orders.shop/` from pod-a

Putting every piece together. pod-a is on node A; the chosen `orders` pod is on node B; overlay networking.

```
 ① DNS
    pod-a resolver: "orders.shop" (1 dot < 5) → try "orders.shop.shop.svc.cluster.local" ✗
                                              → "orders.shop.svc.cluster.local" ✓
    query to 10.96.0.10 (kube-dns ClusterIP) → DNAT to a CoreDNS pod → 10.96.0.50

 ② TCP SYN  10.244.1.5:51000 → 10.96.0.50:80
    leaves pod-a's eth0 → veth → host netns on node A

 ③ Service translation (kube-proxy rules, PREROUTING)
    DNAT → 10.244.2.7:8080, conntrack entry created

 ④ Routing on node A: 10.244.2.0/24 → vxlan0
    encapsulated: outer 10.0.0.11 → 10.0.0.12 UDP 8472

 ⑤ Physical / cloud network delivers to node B

 ⑥ Node B: vxlan0 decapsulates → inner dst 10.244.2.7
    FORWARD hook / CNI programs   ◄── network policy for pod-c's INGRESS checked here
    → veth-c → pod-c eth0

 ⑦ pod-c's app accepts; sees client 10.244.1.5 (no NAT between pods)

 ⑧ Reply SYN-ACK 10.244.2.7:8080 → 10.244.1.5:51000
    back over the tunnel to node A
    conntrack on node A rewrites src → 10.96.0.50:80
    → pod-a. Connection established.
```

Where would a network policy act? On **node A** for pod-a's **egress** (after step ③, so against the pod IP 10.244.2.7:8080) and on **node B** for pod-c's **ingress** (step ⑥). Both must allow it. Replies (⑧) are allowed automatically by conntrack. That's the bridge to part 2.

---

## 11. Debugging cheatsheet

```bash
# Pod's view
kubectl exec -it pod-a -- ip addr; ip route; cat /etc/resolv.conf

# Enter a pod's netns from the node (when the image has no tools)
crictl inspect <container-id> | grep -i pid        # get the PID
nsenter -t <pid> -n ip addr                        # run host tools inside the pod netns
nsenter -t <pid> -n tcpdump -ni eth0 port 8080

# Which endpoints does the Service really have?
kubectl get endpointslices -l kubernetes.io/service-name=orders -o wide

# kube-proxy rules on a node
iptables-save | grep orders                         # iptables mode
nft list table ip kube-proxy                        # nftables mode

# conntrack: NAT entries and table pressure
conntrack -L -d 10.96.0.50
sysctl net.netfilter.nf_conntrack_count net.netfilter.nf_conntrack_max
dmesg | grep conntrack

# MTU problems (overlays): send a 1450-byte packet with DF set
ping -M do -s 1422 <remote-pod-ip>                  # 1422 + 28 bytes of headers = 1450

# DNS
kubectl run -it --rm dnsutils --image=registry.k8s.io/e2e-test-images/agnhost:2.53 -- \
  nslookup orders.shop.svc.cluster.local
```

A layered way to debug "pod A can't reach service B":

1. **DNS:** does the name resolve, and to the IP you expect?
2. **Endpoints:** does the Service have *ready* endpoints? (Empty EndpointSlice means a selector mismatch or failing readiness.)
3. **Pod IP direct:** does `curl <podIP>:<targetPort>` work? If yes, the problem is the Service layer; if no, it's routing or policy.
4. **Policy:** is there a NetworkPolicy selecting either pod? (Part 2.)
5. **MTU:** do small requests work and large ones hang? That's MTU.

---

## 12. Glossary

- **netns**: network namespace; one isolated copy of the network stack. One per pod.
- **veth pair**: two virtual interfaces joined like a cable; connects a pod to the host.
- **CNI**: the spec + plugin binaries that give a pod its network on creation.
- **IPAM**: the part that picks IP addresses.
- **Overlay**: pod packets wrapped in node-to-node packets (VXLAN, Geneve).
- **Native routing**: pod packets sent unwrapped; the network knows the pod CIDRs.
- **ClusterIP**: a virtual Service IP that exists only as a rule on each node.
- **EndpointSlice**: the list of ready pod IPs behind a Service.
- **kube-proxy**: per-node controller that programs Service rules (iptables/nftables).
- **DNAT / SNAT**: rewriting destination / source address. DNAT implements Services; SNAT implements egress masquerade.
- **conntrack**: kernel table of flows; makes NAT and stateful filtering work.
- **MTU**: maximum packet size on a link; overlays reduce it.

**One-line summary:** a pod is a network namespace with a veth cable to the host; the CNI makes pod IPs routable between nodes (overlay, native routes or cloud IPs); Services are DNAT rules on every node chosen once per connection; DNS turns names into those Service IPs; and every packet crosses a few well-defined kernel hooks, which is exactly where network policy gets enforced.

---

### Sources

- Kubernetes docs: [Services, Load Balancing and Networking](https://kubernetes.io/docs/concepts/services-networking/), [Service](https://kubernetes.io/docs/concepts/services-networking/service/), [Virtual IPs and Service Proxies](https://kubernetes.io/docs/reference/networking/virtual-ips/), [EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/), [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/), [NodeLocal DNSCache](https://kubernetes.io/docs/tasks/administer-cluster/nodelocaldns/), [Network Plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/network-plugins/), [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)
- Kubernetes blog: [NFTables mode for kube-proxy](https://kubernetes.io/blog/2025/02/28/nftables-kube-proxy/), [v1.33 release](https://kubernetes.io/blog/2025/04/23/kubernetes-v1-33-release/), [v1.34 release](https://kubernetes.io/blog/2025/08/27/kubernetes-v1-34-release/), [v1.35 release](https://kubernetes.io/blog/2025/12/17/kubernetes-v1-35-release/), [v1.37 release](https://kubernetes.io/blog/2026/08/26/kubernetes-v1-37-release/), [Endpoints deprecation](https://kubernetes.io/blog/2025/04/24/endpoints-deprecation/), [Ingress NGINX retirement](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/), [Gateway API v1.6](https://kubernetes.io/blog/2026/08/03/gateway-api-v1-6-release/)
- KEP-5343 (nftables as default): https://www.kubernetes.dev/resources/keps/5343/
- CNI: [SPEC.md](https://github.com/containernetworking/cni/blob/main/SPEC.md), [libcni v1.2.0 release (spec 1.1.0)](https://github.com/containernetworking/cni/releases/tag/v1.2.0)
- Routing modes and MTU: [Cilium routing concepts](https://docs.cilium.io/en/stable/network/concepts/routing/), [Calico MTU](https://docs.tigera.io/calico/latest/networking/configuring/mtu), [AWS VPC CNI](https://docs.aws.amazon.com/eks/latest/userguide/managing-vpc-cni.html)
- Packet walkthroughs: learnk8s, [Tracing the path of network traffic in Kubernetes](https://learnk8s.io/kubernetes-network-packets) (iptables era, still the best visual tour), Cilium, [Life of a Packet](https://docs.cilium.io/en/stable/network/ebpf/lifeofapacket/)
