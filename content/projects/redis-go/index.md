---
title: "Redis-Go: Redis built from scratch in Go"
date: 2025-02-15T06:00:37+01:00
draft: false
description: "Redis built from scratch"
categories: ["Go", "Redis"]
tags: [""]
---
Redis built from scratch in Go.
## Core Features
- **In-memory KEY VALUE store**
- **RESP Protocol**: [Redis Serialization Protocol](https://redis.io/docs/latest/develop/reference/protocol-spec/)
- **Core Commands**: ```GET```, ```SET```, ```ECHO```, and ```PING```.
- **Passive Expiry**: Redis' passive expiry mechanism, ensuring automatic removal of expired keys upon access.
- **RDB Persistence**: [Redis Database Files](https://rdb.fnordig.de/file_format.html) persistence for data persistence.
- **Handle Concurrent Clients**

## Commands
- ```GET``` get the VALUE using the KEY
- ```SET``` save the KEY VALUE pair data
- ```PING``` to check the health of Redis server
- ```SAVE``` save the in-memory data to .rdb file

## In Progress
- Redis Replication
- Redis Stream
- Redis Transaction
- Redis Pub/Sub

## Source Code
{{< github repo="harisheoran/redis-go" >}}

## Workflows
### High Level Workflow
![](./arch01.png)

### RDB Persistence Workflow
![](./arch02.png)

## Working Demos
### RDB Persistence
{{< youtube id="e74vUgVwgTU" autoplay="true" >}}

### Master-Slave Replication
{{< youtube id="KLDuPfg6lVs" autoplay="true" >}}
