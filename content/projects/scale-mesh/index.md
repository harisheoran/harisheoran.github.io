---
title: "Scale Mesh: A better Vercel alternative"
date: 2024-09-29T06:00:37+01:00
draft: false
description: ""
categories: ["AWS"]
tags: []
---

Scale Mesh: A Vercel alternative.

🧑‍💻You can deploy your web app with just a click.

Features:
1. It dynamically builds and hosts user web apps straight from GitHub repos.
2. View the logs of your deployments.
3. Build & deploy multiple web apps simultaneously from GitHub repos.

## Architecture
![](./featured.png)

![](./scale-mesh-k8s.png)
## Source Code
{{< gitlab projectID="62119438" >}}


There are two Architectures of Scale Mesh
1. Build User's app using AWS ECS.
2. Build User's app using Kubernetes Job.

# ⚙️ Components:
1. Build Server
2. Reverse Proxy API
3. Main API Server
4. Log Collection Pipeline

## 🏗️ Build Server
It builds the code and pushes the artifacts to the S3 bucket.

🤔 How it works?
It is a custom Docker container which uses the GitHub repo URL, clones it and then pushes it and push them to the S3 bucket

🔧 definitionIt is a Multistage Docker build, which builds the Go binary in the first stage and then runs the binary in 2nd stage to build the user's web app code and push the build artifacts to the S3 bucket.

🖼️ Build Server image is pushed to AWS ECR, and then an ECS cluster & Task defination are created to run a container from the ECR image after the task is completed, it'll destroy the container.

👉 So, the user can build  & deploy multiple apps simultaneously, and the load will not affect the primary server.

You can also use Kubernetes Job task to build the web app and push to S3, if we are deploying our app in K8s, making it less dependent on AWS.


## 🙋API Server
The main backend API is the one via which the user interacts with the platform.

🌊Working Flow
➡️User Authentication.
➡️Save the user's web app project info(GitHub repo URL, name) to deploy.
➡️Create single/multiple deployments from the project.
➡️Create the project and Deploy the web app.

## 🧑‍💻Logging Pipeline
The build-Server container pushes the logs to Redis using the pub/sub feature and a web socket server is subscribing to the Redis channel to view the logs.

## Deployment
[Scale Mesh is deployed on Kubernetes Cluster.]()

## Current Issues:
1. User can start multiple build job task, so it should be handled in Message Queue.
2. No logs database, can use Clickhouse DB.
3. For sending logs in redis pub/sub, we can use Kafka.
