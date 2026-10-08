# Owner form polish

Part of the approved dashboard/onboarding visual brief, October 7, 2026.
Started from current main `c1334f1c` in the separate `codex/owner-form-polish`
worktree while PR375's required checks run. Finish PR375's release and integrate
its main result before releasing this follow-up.

## Scope and evidence

| Audit reference | Form | Changes |
| --- | --- | --- |
| S35 / F06 | Add and Edit Service | Owner serif heading, cream card, 16px/48px fields, explicit plum owner actions, independent body scroll and always-visible Cancel/Save. Named dialog semantics. Validation and save errors appear in the visible action area. |
| S35 / F06 | Add-on create/edit and service add-on picker | Matching display headings and cards, readable fields, 44–48px controls and pinned action/error area. Named dialogs and unchanged service compatibility selection/save contracts. |
| S23 / F05 | Add Client | Shared owner surface, border, typography, 44px close and 48px footer actions. Existing fields, duplicate-contact behavior and draft retention remain. Validation focuses the first invalid field; a general save error receives focus. Typing does not move focus to another field. |
| S34 / F04 | Block Time | Shared owner heading/cards/fields/actions, readable timezone and saved blocks. A save/load error receives focus, keeping recovery feedback visible on narrow screens. |

The shared service add-on summary button now has a minimum 44px target. Add-on
creation, editing and selection use the same owner form system; catalog behavior
and compatibility/save contracts remain unchanged.

### Findings verified during implementation

- The actual add-on editor at 390px clipped part of Update Add-on at the bottom
  of its scrolling panel. Its pinned footer now stays visible; before/after
  screenshots are retained as S35-addon-edit-before/after-mobile.png.

- The previous service form used 14px inputs and 40px save buttons. Its customer
  brand variable was absent in the isolated fixture; this is not evidence that
  the production button was transparent. Owner actions now resolve independently
  from the customer booking theme.
- Moving service actions outside the scroll body initially left errors below
  the visible portion of that body. Actual mobile review caught this; errors
  now share the pinned action area and browser checks assert viewport visibility.
- WebKit's native select rendered at 25px despite the shared minimum height.
  Scoped select appearance and a simple chevron retain the native control's
  behavior while producing the intended touch target. Both engines check it.
- Add Client's original failed validation left focus on the submit button.
  The scoped change directs focus after a failed submission only, without
  changing validation rules, API payloads or save behavior.

## Verification

`tests/browser/ownerForms` imports the actual production components, including
the real AppModal/DialogShell, and supplies only memory-only synthetic API
responses. It rejects external requests; no API write reaches a server.

- Chromium and WebKit at 320, 390, 430 and 1280px.
- Readable inputs/selects, reachable actions, no horizontal overflow.
- Add/edit service, advanced controls, Escape/cancel and focus restoration.
- Add-on edit failure retains data; creation validation stays visible; returning
  from the service add-on picker retains the service draft and focus.
- Service validation and simulated save errors stay visible and retain data.
- Client validation/focus, simulated failure retention and local success response.
- Block editing, cancel, remove confirmation recovery and failed-save retention.
- Existing Service, Client, Calendar Block and owner-token unit coverage.
- Hosted CI includes this browser suite; normal lint/typecheck hooks remain.

Before/after screenshots and release results are kept in the dated companion
folder `/Users/me/Documents/Codex/2026-10-07/owner-form-polish`. Baselines are in
the adjacent `owner-core-tabs-polish` folder. These screenshots demonstrate real
components with synthetic data; they do not demonstrate production writes.

## Boundaries

No endpoint, authorization, tenancy, booking conflict, service persistence,
payment, messaging, commercial entitlement or customer Isla design changes.
Existing error/status colours retain their meaning. This scoped form pass does
not claim that every secondary owner form, physical phone or external provider
acceptance is complete. The broader goal's recorded acceptance blocks remain.
