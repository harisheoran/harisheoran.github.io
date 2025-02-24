---
title: "Redis-Go"
date: 2025-02-15T06:00:37+01:00
draft: false
description: "Redis built from scratch"
categories: ["Go", "Redis"]
tags: [""]
---

Redis built from scratch in Go.


## Source Code
{{< github repo="harisheoran/redis-go" >}}

## Workflow
![](./arch01.png)

## Features
- ### RESP Protocol Support:
Fully implemented the Redis Serialization Protocol ```(RESP)```,
supporting both reading and writing.

- ### Core Commands:
Currently supports essential Redis commands, including ```GET```, ```SET```, ```ECHO```, and ```PING```.

- ### Passive Expiry:
Implements Redis' passive expiry mechanism, ensuring automatic removal of expired keys upon access.

- ### Persistence with RDB:
Supports Redis Database ```(RDB)``` persistence for data persistence.



> Currently this project is in progeress...
