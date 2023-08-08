---
title: ""
date: 2023-07-12T20:54:47+01:00
draft: false
description: ""
---

{{< typeit 
  tag=h1
  lifeLike=true
>}}
Lets get in touch
{{< /typeit >}}

{{< button href="mailto: harisheoran01@gmail.com" target="_self" >}}{{< icon "envelope" >}}  Mail me {{< /button >}} 
    
📧  harisheoran01@gmail.com

---

{{< lead >}}
Lets Connect
{{< /lead >}}


{{< icon "twitter" >}} [Twitter](https://twitter.com/harisheoran)

{{< icon "linkedin" >}} [LinkedIn](https://www.linkedin.com/in/harishsheoran01/)

{{< icon "github" >}} [Github](https://github.com/harisheoran)


---

<head>
	<title>Contact</title>
	<meta charset="UTF-8" />
		<script>
  (function (C, A, L) {
    let p = function (a, ar) {
      a.q.push(ar);
    };
    let d = C.document;
    C.Cal =
      C.Cal ||
      function () {
        let cal = C.Cal;
        let ar = arguments;
        if (!cal.loaded) {
          cal.ns = {};
          cal.q = cal.q || [];
          d.head.appendChild(d.createElement("script")).src = A;
          cal.loaded = true;
        }
        if (ar[0] === L) {
          const api = function () {
            p(api, arguments);
          };
          const namespace = ar[1];
          api.q = api.q || [];
          typeof namespace === "string" ? (cal.ns[namespace] = api) && p(api, ar) : p(cal, ar);
          return;
        }
        p(cal, ar);
      };
    })(window, "https://cal.com/embed.js", "init");
    Cal("init")
  </script>
</head>

<body>
	<h1>
		<h3>I am currently open for full-time engineering roles, which involves Android app developmenet.</h3>
        <h4>Interested in working together? Feel free to schedule a meet!</h4>
	</h1>
	<div id="my-cal-embed"></div>
	<script>
		Cal("inline", {
			elementOrSelector: "#my-cal-embed", // You can also provide an element directly
			calLink: "harisheoran", // The link that you want to embed. It would open https://cal.com/jane in embed
			config: {
				name: "", // Prefill Name
				email: "", // Prefill Email
				notes: "", // Prefill Notes
				guests: ["", ""], // Prefill Guests
				theme: "dark", // "dark" or "light" theme
			},
		});
	</script>
	</script>
</body>