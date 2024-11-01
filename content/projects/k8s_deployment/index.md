---
title: "Kubernetes Production Deployment"
date: 2024-10-29T06:00:37+01:00
draft: true
description: ""
categories: ["k8s", "eks"]
tags: []
---

Today, we are going to deploy a web api on Kubernetes with production standards.

Application we are going to deploy is [Scale Mesh](https://harisheoran.github.io/projects/scale-mesh/).

**Application Structure**
- *api-server* is the main API.
- *postgres db* 

<details>
<summary> What we are going to learn during the deployment - 
</summary>
<br>

1. Pods
2. Deployments
3. Replica Set
4. Service
5. Namespace
6. Secrets
7. Ingress
8. Ingress Controller
9. Custom Resources
10. Custome Resource Defination
11. Custom Controller
12. Operators
13. Helm Charts
14. Service Account
15. OIDC
</details>

## Prerequiste
- Install AWS CLI & eksctl

## Create a Kubernetes Cluster
Create the Kubernetes cluster on your favourite cloud or even bare metal, I am choosing on AWS(I got free credits :) ) 

We are using *eksctl* cli tool to create the cluste, but you can another tools like *Terraform*.


I am creating the cluster in a existing VPC, so need to provide the vpc and subnet details
- Create an *eks.yaml* and copy the content of this [snippet](https://gitlab.com/-/snippets/3763721/raw/main/eks.yaml?inline=false)

```
eksctl create cluster -f eks.yaml
```

Wait for a while...

- Create a tag on subnet of your VPC, [so that the AWS Load Balancer controller can auto discover the subnets.](https://kubernetes-sigs.github.io/aws-load-balancer-controller/v2.1/deploy/subnet_discovery/)
    - public subnet- kubernetes.io/role/elb: 1
    - Tag the private subnet- kubernetes.io/role/internal-elb: 1


## Start Deploying
Clone the [Scale Mesh Respository](https://gitlab.com/harisheoran/scale-mesh)

Go the ***k8s*** directory, it contains all the YAML files, 

{{< typeit 
  tag=h1
  lifeLike=true
>}}
Let's begin the chaos
{{< /typeit >}}

### Create a namespace

```
kubectl apply -f namespace.yaml
```

