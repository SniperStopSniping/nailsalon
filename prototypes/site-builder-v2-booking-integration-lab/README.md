# Luster Site Builder V2 + Booking Section Integration Lab

This package is a local-only, mock-data product Lab. It combines the approved
mobile-first Site Builder V2 shell with the approved five-layout Booking
presentation system. It is not imported by the Luster Next.js application and
has no Production route, API, authentication, database, payment, or deployment
integration.

```sh
cd prototypes/site-builder-v2-booking-integration-lab
npm ci
npm run dev
```

Open <http://127.0.0.1:4182>.

Package-local verification:

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The Vite server binds to loopback only and uses a deliberately nonexistent
package-local environment directory, so it does not discover the repository's
environment files. Site documents persist under an integration-Lab-specific,
versioned localStorage key. Mock customer selection and filters are ephemeral
and intentionally stay outside exported Site Builder documents.
