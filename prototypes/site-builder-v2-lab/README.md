# Luster Site Builder V2 Lab — Final Hybrid

An isolated, local-only composition prototype with the mobile-first final hybrid
editor shell. It is not imported by the Luster Next.js application, has no
Production route, uses no Luster environment variables, and stores mock
documents only in versioned browser storage.

```sh
cd prototypes/site-builder-v2-lab
npm ci
npm run dev -- --port 4180
```

Open <http://127.0.0.1:4180>.

The Lab build and tests are intentionally package-local:

```sh
npm test
npm run build
npm run test:e2e
npm run capture:hybrid
```
