####
<style>
        h1, h2 { 
            text-align: left;
        }
        .tech-stack {
            text-align: center;
        }
        .tech-stack .logos {
            display: flex;
            flex-wrap: wrap;
            justify-content: flex-start; 
            align-items: flex-start; 
            gap: 10px; 
            margin: 0; 
            padding: 0; 
        }
        .logos img {
            width: 45px; 
            height: 45px;
            object-fit: contain;
            transition: transform 0.3s;
        }
        .logos img:hover {
            transform: scale(1.2); 
        }
        .intro h1 {
            text-align: left;
            margin-bottom: 0; 
            font-size: 3em; 
        }
        .intro .subheading { 
            text-align: left;
            margin-top: 10px; 
            margin-bottom: 15px; 
            font-size: 1.2em; 
            line-height: 1.2; 
            display: block; 
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
        
        /* Default (Light Mode) Social Links - UPDATED FOR BETTER VISIBILITY */
        .connect-youtube-link,
        .connect-twitter-link,
        .connect-linkedin-link,
        .connect-github-link {
            text-decoration: none;
            padding: 8px 16px;
            border: 1px solid #888; /* Darkened from #ccc */
            border-radius: 8px;
            color: #333; /* Darkened from #a7a7a7 */
            font-size: 16px;
            transition: background-color 0.3s, border-color 0.3s, color 0.3s;
        }
        .connect-youtube-link:hover,
        .connect-twitter-link:hover,
        .connect-linkedin-link:hover,
        .connect-github-link:hover {
            background-color: #f5f5f5;
            border-color: #555; /* Darker border on hover */
            color: #000; /* Pure black text on hover */
        }

        .connect-icon-youtube,
        .connect-icon-twitter,
        .connect-icon-linkedin,
        .connect-icon-github {
            margin-right: 8px;
        }

        /* Dark Mode Adjustments (Tied to the theme's toggle class) */
        .dark .connect-youtube-link,
        .dark .connect-twitter-link,
        .dark .connect-linkedin-link,
        .dark .connect-github-link {
            border-color: #444; 
            color: #e0e0e0; 
        }

        .dark .connect-youtube-link:hover,
        .dark .connect-twitter-link:hover,
        .dark .connect-linkedin-link:hover,
        .dark .connect-github-link:hover {
            background-color: #333; 
            border-color: #666; 
        }
    </style>
</head>
<body>
    <div class="intro">
    <h1>Hi, I am Harish</h1>
    <span class="subheading">Engineer</span>
    <p align="left">I build scalable and high-performance systems. </p>
    </div>
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
            <a href="mailto:harisheoran@protonmail.com" target="_blank" class="connect-twitter-link">
                {{< icon "envelope" >}}
                Mail
            </a>
        </div>
    </section>
</body>