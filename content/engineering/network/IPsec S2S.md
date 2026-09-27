
Bandwidth: measures the **_volume_** of data a network can transport per second, (Link Capacity)
**PPS (Packets Per Second)**:  measures the _processing rate_ of network hardware handling individual units of data. (Hardware Capacity- router max processing speed)

**The Relationship and Packet Size**
PPS is entirely dependent on packet size. A 1 Gbps connection can be filled by a few massive packets or millions of tiny ones. Network devices (routers, firewalls) have to read the header of _every single packet_ to figure out where to send it.

Because of this, processing 1 Gigabit of 64-byte packets requires vastly more CPU power than processing 1 Gigabit of 1500-byte packets.

The basic relationship is:

$$PPS = \frac{\text{Bandwidth (in bps)}}{\text{Packet Size (in bits)}}$$

_(Note: Real-world calculations must account for Ethernet overhead, typically 20 bytes per packet: 8 bytes for preamble + 12 bytes inter-packet gap)._

# Part 1 — What a site-to-site VPN actually is

Two private networks — Azure `10.48.0.0/16`  and AWS `10.1.0.0/18` with the public internet between them. The internet will not route private addresses. A site-to-site VPN makes the two behave as though a private leased line joined them: a pod at `10.48.3.x` sends to `10.1.17.x` and it arrives, unmodified, without either address ever appearing on the public internet.

The mechanism is **encapsulation**. The original private packet becomes the *payload* of a
new packet addressed from one public IP to the other. The internet routes the outer packet; the far end strips the wrapper and injects the original into its local network. Encryption protects the payload in transit.

Site-to-site (S2S) joins whole *networks*, with no client software
anywhere.

## The terms we need to know
https://www.cloudflare.com/learning/network-layer/what-is-ipsec/

**IPsec** — *Internet Protocol Security*. Not one protocol but an IETF suite adding
encryption and authentication at the IP layer. Because it works at layer 3, applications
need no changes.

**ESP** — *Encapsulating Security Payload*. The part of IPsec that wraps and encrypts your
packet, providing confidentiality, integrity and authenticity together. This carries the data.

**AH** — *Authentication Header*. The alternative: integrity and authenticity but **no
encryption**, and it breaks through NAT. Nobody uses it for cross-cloud VPNs. Listed only
so the term isn't mysterious.

**Tunnel mode vs transport mode** — two ways ESP can wrap a packet.
- ***Transport mode*** encrypts only the payload and keeps the original IP header (host-to-host).
- ***Tunnel mode*** encrypts the **entire original packet including its header** and prepends a fresh header carrying the two gateways' public IPs. Site-to-site is always tunnel mode — that is exactly what hides `10.48.x.x` from the internet.

**SA** — *Security Association*. The agreed contract for protecting traffic in **one
direction**: which cipher, which key, which mode, valid how long. Being one-way, a working tunnel always has **at least two SAs**. 
Note: "The SA didn't come up" means the two gateways failed to agree on this contract.

**SPI** — *Security Parameter Index*. A number in every ESP packet meaning "decrypt me with
SA number *n*". It is how a receiver picks the right key when many tunnels land on one gateway.

**IKE** — *Internet Key Exchange*. IPsec encrypts; something must authenticate the peers and
negotiate the SAs and keys. That is IKE. **IKEv2** is the modern version — fewer round trips,
built-in liveness checks, cleaner rekeying, native NAT traversal. Both clouds support it;
pin it. IKEv1 exists and should not be used.

**Phase 1 and Phase 2** — IKE negotiates in two stages:
- *Phase 1* (`IKE_SA_INIT` + `IKE_AUTH` in v2): peers prove identity and build one encrypted
  control channel — the **IKE SA**.
- *Phase 2* (`CREATE_CHILD_SA`): inside that protected channel, negotiate the SAs that carry
  real data — the **CHILD SA** (a.k.a. IPsec SA).

Operationally useful: Phase 1 failures are authentication or proposal mismatches; Phase 2
failures are usually traffic-selector or algorithm mismatches. Logs name the phase, so
knowing which is which tells you where to look.

**Diffie-Hellman group (DH group)** — Diffie-Hellman lets two parties derive a shared secret
over a channel an eavesdropper is reading, without transmitting the secret. The "group" sets
the mathematical parameters and therefore the strength. Group 2 (1024-bit) is obsolete;
**group 14 (2048-bit)** is the sane common floor between AWS and Azure. Must be pinned,
because the two clouds' defaults do not fully overlap.

**PFS** — *Perfect Forward Secrecy*. A fresh Diffie-Hellman exchange on each Phase 2 rekey,
so compromising today's key reveals nothing about yesterday's traffic. Enable it; both sides
must agree on the group.

**PSK** — *Pre-Shared Key*. A shared secret both gateways hold, used in Phase 1 to prove
identity. Certificates are the alternative; for cloud-to-cloud, PSK is standard.

**SA lifetime / rekey** — SAs expire deliberately, by elapsed time (e.g. 3600 s) and by
bytes transferred (e.g. 102400000 KB), then renegotiate. **Configure identical lifetimes on
both sides.** Mismatched lifetimes produce a maddening signature: the tunnel works perfectly,
then drops roughly hourly, because one side tears down while the other still considers the
SA valid.

**DPD** — *Dead Peer Detection*. Periodic "are you alive?" probes over the IKE SA. Without
it, if the far end vanishes ungracefully the near end keeps a zombie SA and blackholes
traffic until the lifetime expires. Azure's default DPD timeout is 45 s.

**NAT-T** — *NAT Traversal*. ESP is IP protocol 50 — no port numbers, so a NAT device has
nothing to translate and drops it. NAT-T wraps ESP inside **UDP 4500** so NATs can handle it.
Both clouds enable it automatically. This is why the firewall rules are UDP, not "protocol 50":

| Port / protocol      | Purpose                          |
| -------------------- | -------------------------------- |
| **UDP 500**          | IKE negotiation                  |
| **UDP 4500**         | IKE + ESP encapsulated for NAT-T |
| IP protocol 50 (ESP) | raw ESP, when no NAT is in path  |
|                      |                                  |

**Route-based vs policy-based** — the crucial architectural distinction.
- ***Policy-based***: decides "encrypt this packet?" by matching source/destination CIDR pairs
  against a policy list. Every new network pair is a new policy. Azure policy-based gateways
  support exactly one tunnel and one traffic-selector pair.
- ***Route-based***: creates a **virtual tunnel interface** and decides by consulting a **routing
  table** — anything routed at the tunnel interface gets encrypted. New networks are just
  new routes.

route-based is what makes BGP, multiple tunnels and ECMP possible at all.

**Traffic selectors** (a.k.a. *proxy IDs*) — the declared "which networks talk to which" for
a CHILD SA. On route-based tunnels with BGP they are wildcards (`0.0.0.0/0` ↔ `0.0.0.0/0`)
and routing does the real work. A mismatch is a classic Phase 2 failure.

**Static routing vs BGP** — how each side learns which prefixes live behind the tunnel.
- ***Static***: you type them in. On Azure that is the **Local Network Gateway's** address-space
  list. Every new AWS VPC means editing Azure.
- ***BGP* (*Border Gateway Protocol*)**: the gateways become routing peers and **exchange
  prefixes automatically**. Add a VPC in AWS and Azure learns it; remove one and Azure
  withdraws it.

**AS / ASN** — *Autonomous System* and its *Number*. An AS is a network under one routing
policy; the ASN identifies it in BGP. Azure VPN gateways default to **ASN 65515**; pick a
distinct private ASN for the AWS side (e.g. **64512**). *eBGP* is BGP between different
ASNs — which is what this is.

**APIPA inside addresses** — each tunnel needs a tiny point-to-point subnet for the two BGP
peers to converse on, taken from link-local `169.254.0.0/16` as a `/30`.

> ⚠️ **Real gotcha.** Azure only permits APIPA BGP addresses in
> **`169.254.21.0`–`169.254.22.255`**, while AWS will happily auto-assign a `/30` from
> elsewhere in `169.254.0.0/16`. Let AWS choose and BGP may never establish *even though the
> IPsec tunnel reports UP*. Always set `tunnel1_inside_cidr` / `tunnel2_inside_cidr`
> explicitly, to `/30`s inside Azure's permitted range.

**ECMP** — *Equal-Cost Multi-Path*. When BGP learns the same prefix over several tunnels at
equal cost, ECMP load-balances across them and — more importantly — survives the loss of any
one without a convergence pause. This is what turns "multiple tunnels" into real redundancy
rather than idle standby.

**MTU / MSS / PMTUD** — *Maximum Transmission Unit* is the largest frame a link carries
(1500 on Ethernet). IPsec headers eat into it, so an AWS S2S tunnel's usable MTU is
**1446 bytes**. **MSS** (*Maximum Segment Size*) is the TCP payload ceiling advertised during
the handshake; AWS sets 1406, Azure clamps TCP SYNs to 1350. **PMTUD** (*Path MTU Discovery*)
is how a sender learns to send smaller: a router drops the oversized packet and returns
**ICMP type 3, code 4** ("fragmentation needed").

> ⚠️ If NSGs or security groups drop that ICMP, PMTUD fails silently and you get the
> signature bug: **small requests fine, larger ones hang forever.**  **Allow ICMP type 3 code 4 explicitly.**

---
