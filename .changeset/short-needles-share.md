---
'@wuchale/vite-plugin': patch
---

Avoid extra module invalidation and default Vite reload handling for source-triggered PO file writes so editing translated source files keeps using normal HMR instead of escalating to a full page reload.
