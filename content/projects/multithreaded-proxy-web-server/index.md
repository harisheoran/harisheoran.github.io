---
title: "Multi-threaded Proxy server"
date: 2025-02-05T06:00:37+01:00
draft: false
description: "Multi-threaded Forware Proxy server built in Go"
categories: ["Go"]
tags: ["tcp"]
---

## Multi-threaded Proxy server
A multi-threaded forward proxy server in Go using low-level socket connections to handle concurrent
client requests efficiently.
- Caching: Build in-memory LRU cache to store and serve frequently accessed response
- Scalability: Integrated LRU cache with mutexes for thread safety and semaphore-based concurrency control
(buffered channels) to manage request limits
- Technical Stack: Go, HTTP, TCP/IP, Concurrency, Channels, Mutex.

## 🚀 Features
- HTTP proxy Support
- Concurrent request handling with semaphore limiting
- Caching Strategy
  - In-memory LRU Cache
- Handling request on TCP level

## Source Code
{{< github repo="harisheoran/multi-threaded-proxy-server" >}}

## Download
[Download the v1.0.1](https://github.com/harisheoran/multi-threaded-proxy-server/releases/tag/v1.0.1)

## 📺 Watch full demo
- {{< youtube id="7NFOJhJmL60" autoplay="true" >}}

## 📂 Project Structure
```
├── app.go                    # contains server classes
├── go.mod                    # go module file
├── helper.go                 # helper functions
├── internal
│   └── cache
│       └── lru.go           # LRU cache implementation
├── main.go
├── proxy.go                  # proxy implementation
```

## 🛠️ Setup & Run
### Clone the repository
``` git clone <repository-url> ```

``` cd multithreaded-proxy-web-server ```

### Install Go dependencies
``` go mod tidy ```

### Build the binary
``` go build -o bin/proxy . ```

### Execute the binary
``` ./bin/proxy -port=9000 ```

now the proxy server is running on port 9000

### Test Locally using Postman
First, setup proxy setting to port 9000 in postman application, and you are all good to send your requests.

## To be implemented (open for contribution)
- HTTPS support
- Cache Invalidation policy
➜  multithreaded-proxy-web-server git:(main)
