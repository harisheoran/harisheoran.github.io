---
title: "Navigation in Android"
date: 2023-08-03T20:54:47+01:00
draft: false
description: ""
categories: ["Android"]
tags: ["Navigation"]
---
### 3 main componenets of Navigation
- NavHost 
- NavGraph
- NavController

1. **NavHost** is the container which is responsible to display *destinations*(each destinations have a unique specific *route*) screens

2. **NavGraph** is the place where all the destiantions and how to naviagte to them are described OR it is map, collection of *composables*( like nodes )

3. **NavController** will control the navigation and take you to your desired destinations.

![Alt text](01.jpg "Image loading...")


```
        NavHost(
            navController = navController,
            startDestination = Home.route,
            modifier = modifier.padding(it)
        ) {
            composable(route = Home.route) {
                HomeScreen() { arg ->
                    navController.navigate("${Details.route}/$arg") {
                        launchSingleTop = true
                    }
                }
            }

            composable(
                route = Details.argWithRoute,
                arguments = Details.argument
            ) {
                DetailsMainScreen()
            }
        }
```

- *NavHost* requires *navController* to control the navigation in itself and a starting point.
- *NavHost* also requires *NavGraph* builder parameter to build navgraph, in above code its in the trailing lambda.
- Each *composable* is like a node in *NavGraph*, which requires a *route*(like a unique location) and in that *composable* we define which compose function should execute here.
