---
title: "Scale Mesh: A better Vercel alternative"
date: 2024-09-29T06:00:37+01:00
draft: false
description: ""
categories: ["AWS"]
tags: []
---

Scale Mesh, a platform to deploy your web apps with ease.

## Architecture
![](./featured.png)

## Source Code 
{{< gitlab projectID="62119438" >}}

## Components
1. ***Build Server***

2. ***Reverse Proxy API***

3. ***Main API Server***

4. ***Frontend Server***

5. ***Log Collection Pipeline***


## Build Server
To build the code and push the artifacts to the S3 bucket.

### How it works?
It is a custom Docker container which uses the GitHub repo url, clones it and then build it and push them to SS3 bucket

***Structure***
- Dockerfile
- entry.sh
- main.go

> It is a Multistage Docker build, which builds the Go binary in first stage and then run the bianry in 2nd stage to build the user's web app code and push the build artifacts to the S3 bucket.

Build Server image is pushed to AWS ECR, and then a ECS cluster & Task defination are created to run a container from the ECR image, and after task completed, it'll destroy the container.

> S3 buckets are uploaded in this path
***__output/{projectID}/*** 

## API Server
Main backend API, via which user interacts with the Web app.

### Working Flow
- User Signup/login 
- Save the user's web app project info(GitHub repo url, name) to deploy.
- Create the project and Deploy the web app.


### Structure 
- ***cmd/web/***
Contains all the API and business logic.

- ***pkg***
Contains the ancillary non-application-specfic code, which could potentially be reused.

- Contains the Database models and methods.

### Endpoints of API server
- ***GET*** ```/health``` to check health of the API.
- ***POST*** ```/deploy``` to deploy the project.
- ***POST*** ```/project``` to save the info of the project.
- ***POST*** ```/user/signup``` to signup.
- ***POST*** ```/user/login``` to login.
- ***POST*** ```/user/logout``` to logout.

## Reverse Proxy API
To serve the user Web App dynamically using the unique project id.

## Frontend Server
Serve a basic HTML template for user to interact with the application.

## Logging Pipeline
Build-Server container pushes the logs to the Redis using pub/sub feature and a web socker server is subscribing to the redis channel.


## Application Deployment (DevOps)

### CI Pipeline (GitLab CICD)
- To build and push the image to Docker Hub registry of API server.

### Deployment on Kubernetes
- ```k8s``` directory contains the YAML files to deploy the web app on k8s.

- How to deploy
    - Create Namespace.
    - Create secret
    - Create DB
    - Deploy service.


