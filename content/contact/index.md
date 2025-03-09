---
title: "Contact"
date: 2023-07-12T20:54:47+01:00
draft: false
description: ""
---
<style>
        h1 {
            text-align: left;
            font-size: 2em;
            margin-bottom: 20px;
        }
        .section {
            margin-bottom: 30px;
        }
        .section h2 {
            text-align: left;
            font-size: 1.5em;
            margin-bottom: 15px;
        }
        .email-contact p {
            text-align: left;
            margin-bottom: 15px;
            font-size: 1.1em;
        }
        .email-contact a {
            display: inline-block;
            padding: 10px 20px;
            background-color: #34495e; /* Light mode button color */
            color: #fff;
            text-decoration: none;
            border-radius: 5px;
            transition: background-color 0.3s;
        }
        .email-contact a:hover {
            background-color: #2c3e50; /* Light mode hover */
        }
        .socials {
            display: flex;
            flex-wrap: wrap;
            gap: 20px;
        }
        .socials a {
            display: flex;
            align-items: center;
            text-decoration: none;
            color: #34495e; /* Light mode social text */
            font-size: 1.1em;
            transition: color 0.3s;
        }
        .socials a img {
            width: 24px;
            height: 24px;
            margin-right: 8px;
        }
        .socials a:hover {
            color: #2c3e50;
        }
        /* Dark Mode Adjustments */
        @media (prefers-color-scheme: dark) {
            body {
                background-color: #1a1a1a; /* Dark mode background */
                color: #e0e0e0; /* Dark mode text */
            }
            h1 {
                color: #e0e0e0;
            }
            .section h2 {
                color: #b0b0b0; /* Slightly lighter gray for subheadings */
            }
            .email-contact a {
                background-color: #4a90e2; /* Brighter blue for dark mode button */
            }
            .email-contact a:hover {
                background-color: #357abd; /* Darker shade on hover */
            }
            .socials a {
                color: #b0b0b0; /* Lighter gray for social text */
            }
            .socials a:hover {
                color: #e0e0e0; /* Brighten on hover */
            }
        }
    </style>
<body>
    <div class="section email-contact">
        <h2>Email Me</h2>
        <p>Feel free to reach out for collaborations, inquiries, or just to say hi!</p>
        <a href="mailto:harisheoran@protonmail.com">Send an Email</a>
    </div>
    <div class="section connect">
        <h2>Connect with Me</h2>
        <div class="socials">
            <a href="https://github.com/harisheoran" target="_blank">
                <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/github/github-original.svg" alt="GitHub">
                    GitHub
            </a>
            <a href="https://x.com/harisheoran" target="_blank">
                <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/twitter/twitter-original.svg" alt="Twitter">
                    Twitter
            </a>
            <a href="https://linkedin.com/in/harisheoran" target="_blank">
                <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/linkedin/linkedin-original.svg" alt="LinkedIn">
                LinkedIn
            </a>
            <a href="https://www.youtube.com/channel/UCkL3XhMfEA46NH57gVSb_Fw" target="_blank">
                {{< icon "youtube" >}}
                    YouTube
            </a>
        </div>
    </div>
</body>
