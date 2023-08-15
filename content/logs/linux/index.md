---
title: "Linux"
date: 2023-08-15T06:54:47+01:00
draft: false
description: ""
---
### Linux File system
```bash
/
/home # home directories and files from users
/bin # user command binaries (cat, echo, etc.)
/sbin # system binaries (need sudo)
/usr # user 
/usr/bin # primary executables that system needs in order to run
/usr/local # programs installed just for that user
/lib # when executables in /bin need additional library files in order to run
/var # variable data (temporary)
/var/log # logs are stored here usually for 30 days
/var/log/syslog # system logs
/var/cache # cached data from programs
/opt # programs that install everything in one directory (not separated in /bin and /lib)
/etc # system wide configurations
/etc/fstab # controls how different filesystems are treated each time they are introduced to a system
/etc/hosts # used to translate hostnames to IP-addresses. 
/etc/hostname # name of the machine
/etc/sudoers # who can act as the super user (sudo)
/tmp # temporary location for running processes
/boot # do not touch - for booting the system
/dev # devices configurations like mouse and keyboard
/media # devices like CD or usb drive auto mounts here
/mnt # temporary mount points for additional filesystems

```
> [More about Linux Filesystem](https://blog.kubesimplify.com/everything-you-need-to-know-about-the-linux-ls-command)


### Linux neccessary commands
```
cd /
pwd
ls

# find the release info
lsb_release -a
cat /etc/os-release
uname -a
lscpu
lsmem

# find syslog
find / -name 'syslog'
find / -iname 'syslog'

# change directory to where syslog is
cd /var/log/

# view the syslog
cat /var/log/syslog
cat /var/log/syslog | less

# view default options for new users
# bash is command language interpreter
man useradd
useradd -D

# change from Bourne shell to Bourne Again SHell
useradd -D -s /bin/bash

# what shell am I running
echo $0
echo $SHELL

# all available shells
cat /etc/shells

# adduser chris # will prompt for password and other info
useradd -m chris

# create user and add a home directory
# useradd -m chad
# useradd -m newuser

# create password
passwd chris

# Add User to Sudo Group
usermod -aG sudo chris

# switch to user
su - chris

# add group
groupadd docker

# get group info
getent group docker

# add your user to the docker group
sudo usermod -aG docker $USER

# what groups user is in
groups chris
cat /etc/group

```