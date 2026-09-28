---
title: Networking Basics
date: 2026-07-26
draft: false
description: "Basics of Networking"
categories: ["networking"]
tags: ["terms"]
---
1. **Bandwidth**: measures the **_volume_** of data a network can transport per second, (Link Capacity, Max Capacity of network link to transfer data over time)

2. **PPS (Packets Per Second)**:  measures the _processing rate_ of network hardware handling individual units of data. (Hardware Capacity- router max processing speed)

**The Relationship and Packet Size**
PPS is entirely dependent on packet size. A 1 Gbps connection can be filled by a few massive packets or millions of tiny ones. Network devices (routers, firewalls) have to read the header of _every single packet_ to figure out where to send it.

Because of this, processing 1 Gigabit of 64-byte packets requires vastly more CPU power than processing 1 Gigabit of 1500-byte packets.

The basic relationship is:

$$PPS = \frac{\text{Bandwidth (in bps)}}{\text{Packet Size (in bits)}}$$

_(Note: Real-world calculations must account for Ethernet overhead, typically 20 bytes per packet: 8 bytes for preamble + 12 bytes inter-packet gap).