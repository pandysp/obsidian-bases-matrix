---
title: Fix production auth bug
area: eng
urgency: 7.3
importance: 7.9
status: open
type: task
---

Customers can't log in after the deploy yesterday — error rate spiking on `/auth/session`. Suspect the new JWT validation broke for accounts created before 2024.
