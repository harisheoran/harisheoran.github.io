---
title: "Static Website hosted on AWS S3 using Terraform"
date: 2023-11-05T20:54:47+01:00
draft: false
description: "Hosting a static website on AWS S3 bucket using Terraform."
categories: ["DevOps"]
tags: ["Terraform", "AWS" ,"S3"]
---

Deploy a static website on AWS S3 using Terraform.

### Github Repository
{{< github repo="harisheoran/memesofthday-terraform" >}}


### Demo
{{< youtube id="TY5rXHXl-Fs" autoplay="true" >}}

### Main Terraform file
```
# create a S3 bucket
resource "aws_s3_bucket" "mybucket" {
  bucket = var.bucketName
}

# bucket ownership
resource "aws_s3_bucket_ownership_controls" "myownershipcontrols" {
  bucket = aws_s3_bucket.mybucket.id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

# make S3 access public so that anyone can access it
resource "aws_s3_bucket_public_access_block" "mypublicaccess" {
  bucket = aws_s3_bucket.mybucket.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

# access control list
resource "aws_s3_bucket_acl" "myacl" {
  depends_on = [
    aws_s3_bucket_ownership_controls.myownershipcontrols,
    aws_s3_bucket_public_access_block.mypublicaccess,
  ]

  bucket = aws_s3_bucket.mybucket.id
  acl    = "public-read"
}

# index.html
resource "aws_s3_object" "index" {
  bucket = aws_s3_bucket.mybucket.id
  key    = "index.html"
  source = "index.html"
  acl = "public-read"
  content_type = "text/html"
}

# error.html
resource "aws_s3_object" "error" {
  bucket = aws_s3_bucket.mybucket.id
  key    = "error.html"
  source = "error.html"
  acl = "public-read"
  content_type = "text/html"
}

# main.js
resource "aws_s3_object" "mainjs" {
  bucket = aws_s3_bucket.mybucket.id
  key    = "main.js"
  source = "main.js"
  acl = "public-read"
  content_type = "javascript"
}

# configure the html files for website
resource "aws_s3_bucket_website_configuration" "memesoftheday" {
  bucket = aws_s3_bucket.mybucket.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "error.html"
  }

  depends_on = [ aws_s3_bucket_acl.myacl ]
}

```