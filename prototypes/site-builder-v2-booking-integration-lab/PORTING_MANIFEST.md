# Selective porting manifest

Integration base: `origin/main` at `35125b284ea0b73c18215a6b0650f4484092bb95`
(tree `824d267490f1f26b583e6375f85df0c060a0acff`).

| Source | Source path | Source commit | Destination | Why it was ported | Modified? |
| --- | --- | --- | --- | --- | --- |
| Approved Site Builder | `prototypes/site-builder-v2-lab/src/model/{catalogue,history,ids,index,normalize,operations,starters,types,validation}.ts` | `c25e506d2174d6693774793ed1ed602365c1a5e7` | `src/model/` | Universal, serializable Site → Pages → Sections model, commands, validation, normalized ordering, history, and starter defaults | Yes — Booking placeholder is evolved into the real Booking section |
| Approved Site Builder | `prototypes/site-builder-v2-lab/src/ui/{App,Dialog,EditorDialogs,FinalStructurePanel,Preview,ReorderList,SectionCard,StarterChooser,useLabDocument}.tsx` | `c25e506d2174d6693774793ed1ed602365c1a5e7` | `src/ui/` | Approved final-hybrid canvas-first editor, sheets/drawers, Pages & Structure, Preview, and Reorder | Yes — integrated renderer, Booking settings, and customer/editor boundary |
| Approved Site Builder | `prototypes/site-builder-v2-lab/src/{styles.css,main.tsx}` and `src/ui/final-hybrid.css` | `c25e506d2174d6693774793ed1ed602365c1a5e7` | `src/` and `src/ui/` | Approved warm Luster visual language and final-hybrid responsive shell | Yes — scoped Booking integration styles |
| Approved Site Builder | package-local Vite, TypeScript, Vitest, Playwright, HTML, package, and ignore files | `c25e506d2174d6693774793ed1ed602365c1a5e7` | package root | Standalone loopback-only Lab entrypoint and focused verification | Yes — unique package identity and ports 4182/4183 |
| Approved Site Builder | focused model tests and final-hybrid owner/reorder browser tests | `c25e506d2174d6693774793ed1ed602365c1a5e7` | `src/model/` and `tests/e2e/` | Preserve structural regression coverage while adapting it to real Booking | Yes |
| Approved Booking Lab | `prototypes/booking-section-design-lab/src/model/{data,model,settings,types}.ts` | `3860e7090750d8cfa7a971566b063df989f722d5` | `src/booking/model/` | Immutable 24-service fixtures, 100-service generator, pricing/duration helpers, session calculations, and presentation validation | Yes — settings are embedded as a strict discriminated document contract |
| Approved Booking Lab | `prototypes/booking-section-design-lab/src/components/{BookingLayouts,BookingPreview,LabDialogs,SettingsPanel}.tsx` | `3860e7090750d8cfa7a971566b063df989f722d5` | `src/booking/` | Five approved layouts, one renderer, shared detail/summary/handoff, and curated owner controls | Yes — one Builder-owned settings surface and explicit edit/preview modes |
| Approved Booking Lab | `prototypes/booking-section-design-lab/src/styles.css` | `3860e7090750d8cfa7a971566b063df989f722d5` | `src/booking/booking.css` | Preserve the approved visual identities and responsive customer flow | Yes — scoped for embedding and semantic token bridge |
| Approved Booking Lab | selected unit/browser assertions | `3860e7090750d8cfa7a971566b063df989f722d5` | integrated tests | Preserve canonical fixture, settings, layout, fallback, and customer-flow proof | Yes — rewritten around the universal document |

Explicitly not ported: either prototype app shell as a second entrypoint; Site
Builder concept-gallery and obsolete concept variants; Booking Lab standalone
settings/router/persistence shell; prior screenshots; build/test output;
`node_modules`; Production routes, adapters, APIs, auth, database, Stripe, or
environment code.
