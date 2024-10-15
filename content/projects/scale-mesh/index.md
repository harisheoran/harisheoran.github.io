---
title: "Scale Mesh"
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

2. ***Reverse Proxy***

3. ***API Server***

4. ***Frontend Server***

4. ***Log Collection Pipeline***

5. ***Socket Server Log Subscription***

## Build Server
To build the code and push the artifacts to the S3 bucket.

### How it works?
It is a custom Docker container which uses the GitHub repo url, clones it and then build it and push them to SS3 bucket

***Structure***
- Dockerfile
- entry.sh
- main.go

> It is a Multistage Docker build, which builds the Go binary in first stage and then run it in 2nd stage to build the user's web app code.

Build Server image is pushed to AWS ECR, and then a ECS cluster & Task defination are created to run a container from the ECR image, and after task completed, it'll destroy the container.


S3 buckets are uploaded in this path - *__output/{projectID}/* 

## API Server
Main backend API, which takes the GitHub repository URL from the user and start the ECS task.

## Frontend Server
Serve a basic HTML template for user to interact with the application.

## Reverse Proxy
To serve the user Web App dynamically using the unique project id.

> Work in progress, currently it just redirects to the s3 url.

