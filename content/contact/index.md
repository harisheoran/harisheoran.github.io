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
        .connect-me-section {
            text-align: left;
        }
        .connect-me-title {
            font-size: 2rem;
            margin-bottom: 30px;
        }
        .connect-me-links {
            display: flex;
            justify-content: left;
            gap: 15px;
            flex-wrap: wrap;
        }
        .connect-youtube-link,
        .connect-twitter-link,
        .connect-linkedin-link,
        .connect-github-link {
            text-decoration: none;
            padding: 8px 16px;
            border: 1px solid #ccc;
            border-radius: 8px;
            color: #a7a7a7 ;
            font-size: 16px;
            transition: background-color 0.3s, border-color 0.3s;
        }
        .connect-youtube-link:hover,
        .connect-twitter-link:hover,
        .connect-linkedin-link:hover,
        .connect-github-link:hover {
            background-color: #f0f0f0;
            border-color: #999;
        }

        .connect-icon-youtube,
        .connect-icon-twitter,
        .connect-icon-linkedin,
        .connect-icon-github {
            margin-right: 8px;
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
            h2 {
                color: #b0b0b0; /* Slightly lighter gray for subheadings */
            }
            .email-contact a {
                background-color: #4a90e2; /* Brighter blue for dark mode button */
            }
            .email-contact a:hover {
                background-color: #357abd; /* Darker shade on hover */
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
        <section class="connect-me-section">
            <div class="connect-me-links">
                <a href="https://x.com/harisheoran" target="_blank" class="connect-twitter-link">
                    {{< icon "x-twitter" >}}
                    Twitter
                </a>
                <a href="https://linkedin.com/in/harisheoran" target="_blank" class="connect-linkedin-link">
                    {{< icon "linkedin" >}}
                    LinkedIn
                </a>
                <a href="https://github.com/harisheoran" target="_blank" class="connect-github-link">
                    {{< icon "github" >}}
                     GitHub
                </a>
                <a href="https://youtube.com/@harisheoran" target="_blank" class="connect-youtube-link">
                    {{< icon "youtube" >}}
                    YouTube
                </a>
            </div>
        </section>
    </div>
</body>
