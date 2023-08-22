---
title: "Spring Boot with Kotlin"
date: 2023-08-05T19:54:47+01:00
draft: false
description: ""
categories: ["Backend"]
tags: ["Spring Boot", "Kotlin"]
---

# Day 1

## Application Class
Main entry point of Spring Boot

## Layers
1. Web Layer / Controller Layer + REST Endpoints mappings 
2. Service Layer
3. Data Source
4. Data layer


#### Web Layer
This layer has the Controllers(These are just classes which have REST endpoint methods)
- **@RestController** annotation for creating controller class.
- **@RequestMapping** annotation for defining the endpoint path
- **@GetMapping**  annotation for GET request.
    ```
    @RestController
    @RequestMapping("/banks")
    class BankController(){

        @GetMapping
        fun getBanks(): List<Bank>{
            ...
        }

    }
    ```

- **@PathVariable** for taking an argument when sending the request.

#### Service Layer
This layer has all the businnes logic

#### Data Source
This layer has storage(database) and retrieve data

- **@Repository** 
    Responsible for interaction between app and underlying data

#### Data Layer
This layer has models, serialization logic, Entity classes

## Project Structure
- **gradle properties** files described which needed to download
- **setting.gradle** contains all the plugins
- **build.gradle** contains all the dependencies needed
- **src**
    - **main** contains the Application class, which is the entry point.
    - **test** contains all the test files
    - **resources** 
        - *static* 
        - *template*
        - *application.properties* contains configuration of whole application like which port to use etc.
## Test Driven Development using Junit 5


## Dependency Injection



