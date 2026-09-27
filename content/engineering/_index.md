---
title: "Engineering"
description: "Engineering notes — working out how things actually work, from first principles."
# Hugo applies `cascade` to this node as well as its descendants, so the
# cascade below would mark this landing page itself a draft and the section
# would 404 in production. Publish it explicitly; the cascade still keeps
# every note beneath it hidden until it says `draft: false`.
draft: false
cascade:
  # Fail closed. Hugo publishes any page that has no `draft` key, so a note
  # moved in here from the vault — or an Excalidraw source file — would go
  # live by accident. This inverts that: nothing renders unless it says
  # `draft: false` explicitly.
  draft: true
  math: true
  showEdit: false
---

Notes I keep while figuring things out — networking, systems, backend.
