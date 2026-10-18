# Isolated custom website renderer

This small static server is a separate deployable, not a Next.js route. It must
run on a different registrable site from Luster administration, without Luster
cookies, credentials, application packages, database or API access. Nothing here
has been deployed.

Local proof environment:

```sh
CUSTOM_SITE_PARENT_ORIGIN=http://localhost:3197 node tools/custom-site-renderer/server.mjs
```

Set `CUSTOM_SITE_RENDER_ORIGIN=http://127.0.0.1:3198` in the isolated Luster
Development environment. Production requires HTTPS and explicit
`CUSTOM_SITE_ISOLATED_ORIGIN_VERIFIED=true` after deployment/security review.
Never point this variable at an administration origin or a shared cookie domain.
The pilot supports one parent origin. Custom-domain hosting needs an explicit,
verified parent-origin allowlist before rollout; do not use wildcard ancestors.

The frame has an opaque sandbox origin (no allow-same-origin), in addition to
using a separate site. Its dedicated worker cannot use persistent origin storage;
BroadcastChannel and nested workers are also removed before generated code runs.
The parent checks the exact frame WindowProxy, null origin and random channel.
Initialization targets that frame with "*" because opaque origins cannot be
named as a postMessage target. The renderer accepts only its configured parent.
The parent sends only public business fields, draft/live source and approved image
bytes. Images of references and
PDFs never enter the public payload. Source HTML is parsed/validated server-side;
CSS is free-form but cannot fetch resources. Inline scripts and event handlers
are rejected. Generated JavaScript is parsed but is **never executed by Node or
the parent document**. It runs in a browser worker, where CSP blocks network and
imports. A small visual-command bridge supports custom interaction state; it
cannot set HTML, URLs, event handlers, booking IDs or canonical data bindings.
A watchdog terminates blocked workers. The trusted DOM runtime connects actual
user clicks to service IDs supplied by Luster. The trusted parent routes to the
existing booking or booking-management pages. Preview mode has no booking route
and uses identifiers rejected by the appointment API.
For visual controllers, `Luster.update({selector, className})` assigns a bounded
plain class list; adding an explicit boolean `enabled` retains the existing
single-class toggle behavior. Class updates cannot change binding attributes,
IDs, links or HTML. A click on a child icon/text reaches its closest control ID
inside the site root, so custom button compositions work with pointer and keyboard
activation. This does not allow generated code to synthesize a booking click.
The parent also exposes a normal booking-menu link outside the frame, so a renderer
outage cannot remove access to the original booking journey.

Browser contracts: [iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe),
[postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage),
[worker CSP inheritance](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers).

Source revisions are immutable database records, referenced by the existing
shared setup draft. Restoring creates a new draft; it never reverses bookings.
Publication changes the live reference only within the existing approved
transaction. Image bytes are checked before commit and on reads. Disabling AI
does not disable this renderer or the existing booking flow.

Before customer rollout: independent security review, resource-exhaustion tests,
PDF parser isolation, immutable asset delivery/retention operations, sandbox
browser compatibility, rendered accessibility/fidelity gates and verified isolated
hosting. Browser workers limit authority, but are not an operating-system CPU or
memory quota. Do not represent this pilot as production-ready.

Private hosted pilot: `api/renderer.mjs` and the local HTTP adapter import the
same handler/runtime. Deploy this directory alone as a separate Vercel project,
Preview target, with only `CUSTOM_SITE_PARENT_ORIGIN` set to the exact owner test
alias. Verify CSP and absence of cookies before enabling the application origin
flag. No database, AI key or application packages belong in this project. The
application uses the Public Suffix List (including private suffixes) to reject
shared cookie sites while allowing separate `*.vercel.app` tenants.

The iframe retains a stable viewport and scrolls its document internally. Never
resize it to its own scrollHeight: custom viewport-height heroes then recursively
grow, especially on mobile.
