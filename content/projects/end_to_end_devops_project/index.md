---
title: "End to End DevOps Project"
date: 2023-11-20T20:54:47+01:00
draft: false
description: "Node JS application"
categories: ["DevOps"]
tags: ["AWS","Jenkins","Ansible", "Terraform", "Docker" ,"Docker-Compose", "EC2", "S3", "Dynamo DB" ]
---

## Programmer Server

Micro Blog website for developers.

## Source Code
{{< github repo="harisheoran/programmer-server" >}}

## Workflow
![](workflow.png)

![](workflow2.png)

## Demo 
{{< youtube id="PA4a0WmBG_k" autoplay="true" >}}

---

## Tech Stack and tools

### Application
- Node JS
- Express JS
- Mongo DB
- Bootstrap 5

### DevOps
- Docker
- Docker Compose
- VCS (Git & Github)
- Terraform
- Ansible
- Nginx
- AWS EC2
- Jenkins

# Next Goals
- Contianer Orchestration using k8s

---
# Website Setup

## Prerequisite
- Install & Configure AWS CLI
- Install Docker and start its service
- Install Terraform & Ansible
- Create two env files

    - ***.env***
    ```
    NODE_ENV=prod
    MONGO_USER=
    MONGO_PASSWORD=
    SESSION_SECRET=
    ```
    - ***.env2***

    ```
    MONGO_INITDB_ROOT_USERNAME=
    MONGO_INITDB_ROOT_PASSWORD=
    ```

    - Inventory file


## Development Setup

## How to run the project locally
- Install npm packages
```
npm install
```

## Build the Docker image and run the container

```
sudo docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

You can access the application on _localhost:3000_
and hit the _/blogserver_ .

# Production Setup

## Infrastructure as Code
### Run the Terrafrom File to launch 2 ec2 instances

```
cd terraform
```
```
terraform init
```

```
terraform apply
```

It'll output 2 IP addresses, copy them(You'll need to configure our ec2 instances).

## Configuration  Management

### For Pipeline
Using Ansible
- First, we configure the Pipeline server

```
cd ansible
```
Paste the IP address in ***inventory.ini***

```
ansible-playbook -i ./inventory.ini ./pipeline.yml 

```
It'll install Jenkins on EC2 and start serving on port 8080.

Now install basic plugins and some additional plugins like 
- Github Integration


### For main server
Now, configure the main ec2 instance, execute the following command
```
ansible-playbook -i ./inventory.ini ./run_app.yml 

```

Web application will start serving at public ip address of ec2 instance.

# CI Setup

After creating EC2 instance, copy the IP address of ec2 instance to ***inventory.ini*** file (in ansible directory)
```
[pipeline]
<paste ip address here> ansible_ssh_private_key_file=/home/harisheoran/my-key.pem ansible_user=ubuntu
```

> Set your path of ***ansible_ssh_private_key*** (your aws key pair value file) 


