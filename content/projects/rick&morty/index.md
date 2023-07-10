---
title: "Rick & Morty App"
date: 2023-06-29T20:54:47+01:00
draft: false
description: ""
categories: ["Android"]
tags: ["MVVM", "Kotlin"]
---

## Rick & Morty App

App to browse characters, Episodes and search details from Rick & Morty App.


#### Download the app [here](https://github.com/harisheoran/rick-morty-app/releases).

#### View code on Github
{{< github repo="harisheoran/rick-morty-app" >}}




#### Read about its MVVM architecture [here](https://sparrowbit.hashnode.dev/basic-mvvm-android-app).

#### Tech Stack
- Kotlin Language
- MVVM Architecture 
- Retrofit
- Picasso
- Epoxy RecyclerView
- Paging 3
- Moshi

### MVVM Architecture
![Alt text](arch.jpg "Image caption")

Start from Network Layer

#### 1. **Network Layer**

4 main components are

- Service Interface
    - It define how the app should talk to server
```
interface RickAndMortyService {

    @GET(value = "character/")
    suspend fun getCharactersPage(@Query(value = "page") pageIndex: Int): Response<GetCharactersPageResponse>
}        
```

- Retrofit service
    -  Creates an implementation of the API endpoint defined by our interface and pass that service to our API client.

 ```
 object NetworkLayer {

    val moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()

    private val retrofit: Retrofit = Retrofit.Builder()
        .client(getLoggingHttpClient())
        .baseUrl("https://rickandmortyapi.com/api/")
        .addConverterFactory(MoshiConverterFactory.create(moshi))
        .build()

    private val rickAndMortyService: RickAndMortyService by lazy {
        retrofit.create(RickAndMortyService::class.java)
    }

    val apiClient = ApiClient(rickAndMortyService)
}
```

- API Client
    - Through which our app will talk to server.
    - It has the methods to talk to API

- Network Error handling





writing ....
--- 
