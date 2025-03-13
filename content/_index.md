######
<style>
        h1 h2 {
            text-align: left;
        }
        .tech-stack {
            text-align: center;
        }
        .tech-stack .logos {
            display: flex;
            flex-wrap: wrap;
            justify-content: flex-start; /* Aligns logos to the left */
            align-items: flex-start; /* Ensures vertical alignment starts at top */
            gap: 10px; /* Spacing between logos */
            margin: 0; /* Removes default margins */
            padding: 0; /* Removes padding to align fully left */
        }
        .logos img {
            width: 45px; /* Slightly smaller logos */
            height: 45px;
            object-fit: contain;
            transition: transform 0.3s;
        }
        .logos img:hover {
            transform: scale(1.2); /* Hover effect */
        }
        .intro h1 {
            text-align: left;
            margin-bottom: 0; /* No gap below main heading */
            font-size: 3em; /* Larger size for main heading */
        }
        .intro .subheading { /* New class for "Software Engineer" */
            text-align: left;
            margin-top: 10px; /* Minimal gap from main heading */
            margin-bottom: 15px; /* Space before next section */
            font-size: 1.2em; /* Smaller than h1, standard text size */
            line-height: 1.2; /* Tighten line height */
            display: block; /* Ensure it’s on a new line */
        }
        /* CSS */
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
    </style>
</head>
<body>
    <div class="intro">
    <h1>Hi, I am Harish</h1>
    <span class="subheading">Engineer</span> <!-- Changed to span with subheading class -->
    <h2>What do I do?</h2>
    <p align="left">I build scalable, high-performance systems —APIs, microservices, and distributed systems, while driving automation, reliability, and cloud-ready infrastructure through DevOps expertise. My work empowers teams and delivers results that scale.
    </p>
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
            <a href="https://youtube.com/@harisheoran" target="_blank" class="connect-youtube-link">
                {{< icon "youtube" >}}
                YouTube
            </a>
        </div>
    </section>
    <div class="tech-stack">
        <h2 align="left">Technologies I Work With</h2>
        <div class="logos" align= "left">
            <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/go/go-original.svg" />
            <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/python/python-original.svg" />
            <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/redis/redis-original.svg" />
            <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/apachekafka/apachekafka-original.svg" />
            <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/postgresql/postgresql-original.svg" />
            <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/kubernetes/kubernetes-original.svg" />
            <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/amazonwebservices/amazonwebservices-plain-wordmark.svg" />
            <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/googlecloud/googlecloud-original.svg" />
            <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/docker/docker-original.svg" />
            <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/terraform/terraform-original.svg" />
            <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/argocd/argocd-original.svg" />
            <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/githubactions/githubactions-original.svg" />
            <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/gitlab/gitlab-original.svg" />
            <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/prometheus/prometheus-original.svg" />
            <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/grafana/grafana-original.svg" />
            <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/linux/linux-original.svg" />
            <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/bash/bash-original.svg" />
</div>
