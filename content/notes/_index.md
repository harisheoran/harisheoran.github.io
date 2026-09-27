---
title: "Notes"
description: "Engineering notes — working out how things actually work, from first principles."
cascade:
  # Fail closed. Hugo treats a page with no `draft` key as PUBLISHED, so a
  # stray file dropped in here — an Excalidraw drawing, a half-written note —
  # would go live by accident. Cascading draft: true inverts that: a note is
  # hidden unless it explicitly says `draft: false`.
  draft: true
  # KaTeX for the whole section (see layouts/partials/extend-head-uncached.html)
  math: true
  showEdit: false
---

Notes I keep while figuring things out — networking, systems, backend. Written
first for me, published in case they're useful to you. They get revised as my
understanding does.
