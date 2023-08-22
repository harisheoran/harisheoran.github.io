---
title: "CI/CD"
date: 2023-08-22T06:54:47+01:00
draft: false
description: "Github Actions"
categories: ["CI/CD"]
tags: ["Github Action"]
---

## Basic Github Action Workflow
```
# name of the workflow
name: ci

# defining when should the wokflow should be triggered, in our case it should be when code is pushed on the main branch
on:
  push:
    branches:
      - "main"


# jobs - contain a list of jobs which will be executed
# build - it is the name of our first job
# runs-on - it is the name of OS which it will run on.
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      # this step checkouts the repo code onto your runner environment which is 'ubuntu-latest'
      -
        name: Checkout
        uses: actions/checkout@v3
      # login into Docker Hub account
      -
        name: Login to Docker Hub
        uses: docker/login-action@v2
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}
      # this step build the Docker Buildx, a tool for building a multi-platform Docker images.
      -
        name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2
      # This step uses the docker/build-push-action@v4 action to build and push the Docker image.
      -
        name: Build and push
        uses: docker/build-push-action@v4
        with:
          context: .            # build context which is the root directory
          file: ./Dockerfile    # path to Dockerfile
          push: true            # push the built image
          tags: ${{ secrets.DOCKERHUB_USERNAME }}/sparrowbot:latest       # Specifies the image tag using the Docker Hub username from GitHub Secrets and the tag "sparrowbot:latest".
          build-args: |                                                   # Provides build arguments to the Docker build process, here it sets 2 token for the bot
            SLACK_BOT_TOKEN=${{ secrets.SLACK_BOT_TOKEN }}
            SLACK_SIGNING_SECRET=${{ secrets.SLACK_SIGNING_SECRET }}
```