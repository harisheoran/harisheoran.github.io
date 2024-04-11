---
title: "Creating Infrastructue on AWS using Terraform"
date: 2024-03-29T09:00:37+01:00
draft: false
description: "Creating infratstructure on AWS using Terraform"
categories: ["IaC"]
tags: ["AWS", "Terraform"]
---

This version includes Creating AWS infrastructure using Terraform

## Terraform
Terraform is a tool by Hashicorp for managing you infrastructure using code.
Define your infrasturctue in HCL.

### Benefits
- Easy to manage the infra with code.
- Works with major Cloud Providers.
- Support Hybrid Cloud.

### Working
1. Initialize the terraform
```
terraform init
```

2. Plan the infrastructure
```
terraform plan
```

3. Apply the infrastructure
```
terraform apply
```

> Lets understand the Terraform practically by creating infra on AWS. 

## Infrastructure Requirements
1. S3 bucket (for hosting website files)
    - Upload files
    - Enable static website hosting
    - Attach Bucket Policy

2. Create a SSL/TLS certificate for website
    - Use AWS Certificate Manager (ACM)
    - Create this in North Verginia region 

- First, we need to initialize the terraform and provide it the cloud service on which we want to create infra.
```
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Configure the AWS Provider
provider "aws" {
  region = "us-east-1"
}
```
> ***terraform*** block is to configure the terraform with cloud provider.

> ***provider*** block is to configure the cloud with the region.


- Now initialise the terraform
```
terraform init
```

![](./img/init.png)

## 1. Create a S3 bucket.

```
resource "aws_s3_bucket" "my-main-s3" {
  bucket = "harisheoran.xyz"

  tags = {
    Name        = "main"
    Environment = "prod"
  }
}
```

> ***resource*** block is to create resource on the cloud.

> ***aws_s3_object*** is Terraform resource type, which represents a cloud's resource or service or component.

> ***my-main-s3*** is the logical name of the resource. This allows you to refer to this specific instance of the resource within your Terraform configuration.

> ***{ }*** this block contains the configuration of the resource.

- Execute ``` terraform plan ```

It is a dry run, it show the logs of the infrastructure which is going to create.

![](./img/plan.png)

- Finally, create the infrastructure.
```
terraform apply
```

![](./img/apply.png)

## Terraform State
Terraform State is the brain of terraform, using the state it knows about all the resources it created. 
Terraform create a state file after creating the resources, it records the logs of resources it has created.

### Terraform State working
Terraform create state file when you execute ``` terraform apply ``` for the first time, it saves the info of all the resources you created. When you want to create more resources or update the existing one, you write the configuration and apply the changes, then it checks the state file and checks for existing resources, and compare it with the what it have to create or update and find the difference and update or create accordingly.

### Terraform State benfits
Let say we create an EC2 instance using Terraform and after that we want to add a tag to it.
- if state don't exist, Terraform has no idea that it already created an EC2 instance, so it'll create a new one.
- if state exist, it'll check first that EC2 instance is already created and it'll add tag to it.

### Terraform State Drawbacks


### Terrform State Solutions


## Terraform Modules?
Modules are like resuable functions of terraform to create infra.
If we have to create big infrastructure, then it would be mess to create all resources in one file, it'll be hard to understand and maintain the code by team.
So, we can create different modules for infra, and these modules don't have to exist in our repo, they can be hosted anywhere.

### How to create Modules?
- Create a new directory for each module
```
mkdir modules
mkdir modules/s3_bucket
```

- Create the terraform files inside the module normally as we did before.

![](./img/modules.png)

- Define which module to use in root *main.tf*
```
module "s3_bucket" {
  source = "./modules/s3_module"
}

```

## Variables
Variables are like as the name suggest.

### Input Variables
To Provide variables to terraform files
```
variable "bucket_name" {
  type = string
  description = "Bucket name same as Domain name."
  default = "harisheoran"
}

```


### Output Variables
To get values after resource is successfully created or modified

```
output "website_address" {
  value = aws_s3_bucket.main_s3_bucket.website_endpoint
}

```

### How to pass values to input variables?
Many ways to do this, but standard way is using ***.tfvars*** file
Define input variable and provide values of those variable in tfvars and use it.

```
terraform apply -var-file=”prod.tfvars”
```

## 2. Create SSL/TLS certificate using ACM
We need to create this cert in another region than other aws resources
```

# Configure the AWS Provider Region 1
provider "aws" {
  region = "ap-south-1"
  alias = "indian_region"
}

provider "aws" {
  region = "us-east-1"
  alias = "north_v_region"
}

module "s3" {
  source = "./modules/s3"
  bucket_name = var.bucket_name
  providers = {
    aws = aws.indian_region
  }
}

module "acm" {
  source = "./modules/acm"
  bucket_name = var.bucket_name
  providers = {
    aws = aws.north_v_region
  }
}
```

















## Terraform Workspaces?


## Blogs refrence
- [Creating and validating ACM certificates with Terraform  ](https://headforthe.cloud/article/managing-acm-with-terraform/)
