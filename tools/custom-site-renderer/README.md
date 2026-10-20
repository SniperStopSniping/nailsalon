# Isolated custom website renderer

This small static server is a separate deployable, not a Next.js route. It must
run on a different registrable site from Luster administration, without Luster
cookies, credentials, application packages, database or API access. Verify the
actual deployment and parent origin before enabling it in an application.

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
The interaction worker uses an opaque data URL: HTTPS WebKit can reject
blob:null workers from an opaque frame. UTF-8 source is encoded without changing
the saved design. Worker CSP still blocks network/imports; the parent script
policy permits only the hashed trusted boot, without blob scripts or eval.
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
The deterministic `tests/browser/rendererIsolationHttps` suite exercises the
actual handler/CSP with synthetic HTTPS parents in desktop/mobile Chromium and
WebKit, including hostile and runaway code, navigation and rejected origins.
It performs no Production requests or provider/database operations.

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

## Bundled typography

New custom source may use `Luster Serif v1` (Cormorant normal/italic, 300–700),
`Luster Sans v1` (DM Sans normal, 100–1000), or `Luster Script v1` (Pinyon Script,
400), with generic fallbacks. Latin and Latin-extended glyphs total 283,444 bytes.
The fixed pack is embedded in the trusted boot covered by its CSP script hash;
font-src permits only data URLs, and network access stays disabled. No browser
request reaches Google Fonts. AI cannot author font-face definitions or font URLs.
These optional families do not alias old system font names or change previously
approved designs. Freeze v1 bytes and aliases; add a new version for replacements.
Unsupported scripts and exact reference-font matches still require honest limits.

`fonts/v1/manifest.json` records original family, source, glyph range, size,
checksum and retrieval date. The unmodified official WOFF2 files and their full
SIL Open Font License notices ship together. Source/license provenance is in
the manifest, not fetched at runtime. There are no provider keys or packages.
