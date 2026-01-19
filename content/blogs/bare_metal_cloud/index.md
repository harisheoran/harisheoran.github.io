---
title: "Building a Bare Metal Cloud"
date: 2025-12-26T06:00:37+01:00
draft: false
description: "Running production on Raspberry Pi"
categories: ["Blog"]
tags: ["on-prem"]
---

We are going to run the production workload on our Raspberry Pi 5 and explore what it takes to run the true production workload.
1. Reliability & Availability
2. Fault Tolerance & Resilience
3. Scalability
4. Security
5. Observability

Technologies we are going to work with 
1. Linux
2. Kubernetes
3. Filesystem: ZFS
4. VPN
and more...

> This is a in progress blog...

![](./img/buy_hardware.jpeg)

# Basic Setup 
Lets start with setting up Raspberry Pi OS Lite(we don't need the desktop) and then install [Raspberry Pi software](https://www.raspberrypi.com/software/) on you machine and flash the SD card or your ssd and then insert it into your pi and plug in the charger and ethernet cable.

Things to consider when you are preparing a bootable sd card
- Enable SSH via password or public key

Now ssh into pi, we are into our pi production server, but it is not production yet.
- Scan your network to find out which private IP your DHCP assign to your pi.
 ```
 nmap scan 192.168.1.0/24
 ```
then use the IP to shh

```
ssh piprod@192.168.1.103
```

Lets start with updating the packages
- Update package list
```
sudo apt update
```
-  Upgrade installed packages
```
sudo apt upgrade
```
- Full Upgrade
```
sudo apt full-upgrade
```


I have inserted 2 USB for little more storage, issue is that it is not mounted by default
```
piprod@piprod:~ $ df -h

Filesystem      Size  Used Avail Use% Mounted on
udev            3.9G     0  3.9G   0% /dev
tmpfs           1.6G   14M  1.6G   1% /run
/dev/mmcblk0p2   29G  3.9G   24G  15% /
tmpfs           4.0G     0  4.0G   0% /dev/shm
tmpfs           5.0M   48K  5.0M   1% /run/lock
tmpfs           1.0M     0  1.0M   0% /run/credentials/systemd-journald.service
tmpfs           4.0G     0  4.0G   0% /tmp
/dev/mmcblk0p1  510M   75M  436M  15% /boot/firmware
tmpfs           1.0M     0  1.0M   0% /run/credentials/getty@tty1.service
tmpfs           1.0M     0  1.0M   0% /run/credentials/serial-getty@ttyAMA10.service
tmpfs           807M   32K  807M   1% /run/user/1000
```

now check that if pi is detecting the hardware or not

```
piprod@piprod:~ $ lsblk

NAME        MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS
loop0         7:0    0    2G  0 loop 
sda           8:0    1 28.7G  0 disk 
└─sda1        8:1    1 28.7G  0 part 
sdb           8:16   1 14.3G  0 disk 
└─sdb1        8:17   1 14.3G  0 part 
mmcblk0     179:0    0 29.5G  0 disk 
├─mmcblk0p1 179:1    0  512M  0 part /boot/firmware
└─mmcblk0p2 179:2    0   29G  0 part /
zram0       254:0    0    2G  0 disk [SWAP]
```

so we can see the 3 storages, one is our SD card and rest 2 are our USB drives, but not mounted, so lets mount them.

**What is mounting?**
**Mounting** is the process of attaching a storage device to a specific directory in the linux filesystem.

 - Create the Mount Points
First, we create empty folders, these are just normal directories, but they will act as the entry point for your USB drives.
```
sudo mkdir -p /mnt/sandisk32
sudo mkdir -p /mnt/sandisk16
```

- Mount the USB drives
```
sudo mount /dev/sda1 /mnt/sandisk32
sudo mount /dev/sdb1 /mnt/sandisk16
```

- Verify 
```
df -h
```

Issue with this approach is you have to do mount everytime you reboot your pi, another way to do this using the **`/etc/fstab`** (File System Table) file. This is a configuration file that Linux reads every time it boots up.

1. Identify your drives by UUID
In Linux, drive names like `/dev/sda1` can change. If you plug the 32GB drive into a different USB port, it might become `/dev/sdb1`. This will break things.

To prevent this, we use the **UUID** (Universally Unique Identifier).
- Run this command to find UUID of USB drives

```
piprod@piprod:~ $ lsblk -f

NAME        FSTYPE  FSVER            LABEL       UUID                                 FSAVAIL FSUSE% MOUNTPOINTS
loop0       swap    1                                                           
sda                                                                             
└─sda1      vfat    FAT32            SANDISK32   3EC7-4720                              28.6G     0% /mnt/sandisk32
sdb         iso9660 Joliet Extension ARCH_202507 2025-07-01-17-34-06-00         
└─sdb1      vfat    FAT32            SANDISK16   327C-0EB6                              14.3G     0% /mnt/sandisk16
mmcblk0                                                                         
├─mmcblk0p1 vfat    FAT32            bootfs      EACA-13DA                             435.3M    15% /boot/firmware
└─mmcblk0p2 ext4    1.0              rootfs      21724cc6-e5a3-48a1-8643-7917dba3a9fb   23.4G    14% /
zram0       swap    1                zram0       4920a812-2d0d-4979-81bd-59dd558c217b                [SWAP]
```

**Look for the `UUID` column.** It will look like `5E24-1234`

2.  Understanding the "fstab" Syntax

When you open `/etc/fstab`, you add a line with six columns. It looks intimidating, but here is what each part means.
- **Device**: The UUID of your drive`UUID=3EC7-4720`
- **Mount Point**: Where the files should appear `/mnt/usb1`
- **File System**: The format (Type) `vfat` (for FAT32) or `ntfs-3g` or `ext4`
- **Options**: How the drive behaves `defaults,nofail,user,rw`
- **Dump**: For ancient backup tools `0` (Always use 0)
- **Pass**: Order of disk check at boot|`0` (0 means don't check)
  
there is one issue in this, if we save the above information in fstab file and don't mount those USB drives into pi then the Pi will normally get stuck in a "Emergency Mode" loop because it can't find the drive.

The "Options" column is where the magic happens. 
- **`defaults`**: Gives you basic read/write permissions.
- **`nofail`**: **CRITICAL.** If you unplug your USB and reboot, the Pi will normally get stuck in a "Emergency Mode" loop because it can't find the drive. `nofail` prevent it.
- **`umask=000`**: (Only for FAT32/NTFS) This ensures every user on the Pi can read and write to the drive without permission errors.

here is our final fstab file
```
proc            /proc           proc    defaults          0       0
PARTUUID=8c2ad478-01  /boot/firmware  vfat    defaults          0       2
PARTUUID=8c2ad478-02  /               ext4    defaults,noatime  0       1
UUID=3EC7-4720  /mnt/sandisk32  vfat  defaults,nofail,umask=000  0  0
UUID=327C-0EB6  /mnt/sandisk16  vfat  defaults,nofail,umask=000  0  0
```

3. Test it
```
sudo mount -a
```

4. Reboot
```
sudo reboot
```

5. Confirm
```
df -h
```

### Install basic tools
- git
- zsh and oh-my-zsh (Personal Prefrence)

```
sudo apt install git
sudo apt install zsh
chsh -s $(which zsh)
```

exit and ssh into pi again for ZSH to take place

### Set the Static IP on the pi
If you see currently your DHCP server assign a available private IP to your pi and if you reboot or restart your wifi router you'll get new IP address, we don't want that,

I want to assign the first IP available `192.168.1.2` and to make sure that it is available and not any other device in your home is connected to it, change the range of IP address in your home wifi router portal (192.168.1.1), in our case we reserved from 192.168.1.2 to 192.168.1.100

![](./img/dhcp.png)

Use the `nmtui` tool
1. Type: `sudo nmtui`
2. Select **"Edit a connection"** and press Enter.
3. Select your active connection (usually **"preconfigured"** or your WiFi name) and select **Edit**.
4. Find the **IPv4 CONFIGURATION** line. It will say `<Automatic>`.
5. Change it to **Manual** by pressing Enter and selecting it from the list.
6. Select **Show** next to IPv4 to reveal the hidden fields.
7. **Fill in the blanks:**
    - **Addresses:** `192.168.1.50/24` (The `/24` is crucial; it tells the Pi the "size" of the network).
    - **Gateway:** `192.168.1.1`
    - **DNS Servers:** `8.8.8.8` (or your router's IP).
8. Scroll to the bottom and select **OK**.
9. Select **Quit** to exit.

Finally apply the changes and reboot
```
sudo systemctl restart NetworkManager
sudo reboot
```

SSH into pi again
```
ssh piprod@192.168.1.2
```

# Access the server
Currently you can access the pi server only if you are connected to you home network too, you can't remotely access it.

### Lets setup VPN
```
sudo apt update
sudo apt install wireguard -y
```


### Setup the Duck DNS
- install and enable cron