# Luster Site Builder V2 Lab

An isolated, local-only composition prototype. It is not imported by the Luster Next.js application, has no Production route, uses no Luster environment variables, and stores mock documents only in versioned browser storage.

```sh
cd prototypes/site-builder-v2-lab
npm ci
npm run dev
```

Open <http://127.0.0.1:4176>.

The Lab build and tests are intentionally package-local:

```sh
npm test
npm run build
npm run test:e2e
```
