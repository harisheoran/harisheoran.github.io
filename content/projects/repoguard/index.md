---
title: "Repoguard"
date: 2024-06-08T09:00:37+01:00
draft: false
description: "Monitor access of GitHub Repository access."
categories: ["GO"]
tags: ["CLI"]
---
Repoguard is CLI tool built in Go language to monitor access of GitHub Repository access. 

## Source Code
{{< github repo="harisheoran/repoguard" >}}


### How to Install
- Go to the [Release](https://github.com/harisheoran/repoguard/releases) section
- Download for your OS

```
wget <file link from release section for your OS>
tar -xzvf <downloaded tar file>
mv repoguard /usr/local/bin
```

### How to use Repoguard?
- Configure the CLI
``` repoguard configure ```

and provide it the GitHub Token

- ```users``` command to get a list of collaborators.
    - Use flag ```--u``` for providing the username of GitHub.
    - Use flag ```--r``` for providing the GitHub repository name.

- ```revoke``` to revoke access of a user.
    - Use flag ```--o``` for providing the owner of GitHub(the name of admin github account)
    - Use flag ```--r``` for providing the repository name of GitHub account of that owner.
    - Use flag ```--u``` for providing the username whom access you want to revoke.

### Features
#### Implemented
- Get a list of users who have access to the GitHub Repository.
- Revoke access of user.
- Configure repoguard for your GitHub account.

## Demo
{{< youtube id="TZ5fXzbPdCs" autoplay="true" >}}
