---
title: "Rick & Morty Collection App"
date: 2023-06-29T20:54:47+01:00
draft: false
description: "App to browse characters, episodes and search details from Rick & Morty Tv show."
categories: ["Android"]
tags: ["MVVM", "Kotlin"]
---

{{< lead >}}
App to browse characters, episodes and search details from Rick & Morty Tv show.
{{< /lead >}}


{{< button href="https://github.com/harisheoran/rick-morty-app/releases" target="blank" >}}
Download app 
{{< /button >}}

#### View source code on Github
{{< github repo="harisheoran/rick-morty-app" >}}

--- 
### Gallery
{{< gallery >}}
  <img src="gallery/01.png" class="grid-w50 md:grid-w33 xl:grid-w25" />
  <img src="gallery/02.png" class="grid-w50 md:grid-w33 xl:grid-w25" />
  <img src="gallery/03.png" class="grid-w50 md:grid-w33 xl:grid-w25" />
  <img src="gallery/04.png" class="grid-w50 md:grid-w33 xl:grid-w25" />
  <img src="gallery/05.png" class="grid-w50 md:grid-w33 xl:grid-w25" />
  <img src="gallery/06.png" class="grid-w50 md:grid-w33 xl:grid-w25" />
  <img src="gallery/07.png" class="grid-w50 md:grid-w33 xl:grid-w25" />
  <img src="gallery/08.png" class="grid-w50 md:grid-w33 xl:grid-w25" />
{{< /gallery >}}

--- 

### Demo
{{< youtube id="BJ37aAP6ghU" autoplay="true" >}}

---

#### Read about its MVVM architecture [here](https://sparrowbit.hashnode.dev/basic-mvvm-android-app).

#### Tech Stack & Libraries
- Kotlin Language
- MVVM Architecture 
- Retrofit
- Picasso
- Epoxy RecyclerView
- Paging 3
- Moshi

#### API
- [The Rick and Morty API](https://rickandmortyapi.com/)

### MVVM Architecture
![Alt text](arch.jpg "Image caption")

Start from Network Layer

### 1. **Network Layer**

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
    - It has the methods to talk to API and return the response inside our Network Error handling

- Network Error handling Class *SimpleResponse*

    A simple kind of wrapper class 

    - It have 3 constructor as a parameter - Status, reponse from API client and exception

    - It has some properties to check weather the response is successfull or failed


### 2. **Repository Layer**

We have 3 repository for fetching Character list( for home screen), Single Charater and Episodes.

```
class CharacterListRepository {
    suspend fun getCharactersPage(pageIndex: Int): GetCharactersPageResponse? {
        val request = NetworkLayer.apiClient.getCharactersPages(pageIndex)

        if (request.failed || !request.isSucceed) {
            return null
        }
        return request.body
    }
}
```

- Sending request to api using Api client 

``` 
val request = NetworkLayer.apiClient.getCharactersPages(pageIndex)
```
then checking the request and return accordingly.

### Paging 3 

...

### ViewModel 

...

### UI
...


### Epoxy UI
...


### Data binding
...