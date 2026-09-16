# Owner Assistant — pilot runbook and disclosure

**Status:** preparation only. The assistant is **disabled in every environment**; no OpenAI key, signing secret or allowlist entry exists in production. Turning it on for a salon is an explicit Owner action and is not covered by any merged pull request. This document is what that action would look like when authorized.

## 1. What the assistant is

A conversational, **read-only** helper inside the owner dashboard and the booking-page editor. The owner types naturally; an OpenAI model interprets, asks clarifying questions and explains, and calls narrowly scoped Luster tools for every fact it states. Luster code decides identity, permissions, salon scope, and every number the owner sees.

**It can:** answer about the salon's own services and add-ons (prices, durations, active/bookable state), describe setup and publication state, explain why a given day has no online times using the same availability rules as the public booking page, report what is missing before publishing, and point to the exact screen for a task. It handles follow-ups ("What about Saturday?") because the conversation window travels with the client, signed.

**It cannot:** change anything (no write tool exists), see clients, appointments, revenue, phone numbers, emails or Google event titles, act for another salon, or be used by a collaborator, an impersonating super-admin, or anyone without an explicit owner membership.

## 2. Disclosure to the pilot owner (Owner decision A-4)

Shown in the sheet on every open:

> AI assistant. It uses your Luster setup to answer questions and cannot change anything.

Tell the pilot owner, in writing, before enabling:
- The assistant is AI. It can be wrong, and it will sometimes say it cannot check something. Nothing it says changes the salon.
- The questions they type are sent to OpenAI under the API terms: the content is **not used to train models**, the assistant stores conversations **nowhere** on Luster's side, and provider-side storage is switched off on every request (`store: false`), so retention is limited to the provider's own abuse-monitoring window.
- Luster keeps a per-turn record of token counts, cost, which tools ran and the outcome — **never the words** of the conversation.
- They should not type client names, phone numbers or other personal details into it; it does not need them and has no tool that reads them.
- They can report a bad answer from the sheet, and they can ask for the assistant to be switched off at any time.

## 3. Activation (Owner action; not performed by any PR)

Prerequisites:
1. A dedicated OpenAI project and API key for the owner surface, with a monthly project budget (recommended **$10**) and a usage alert. Never reuse a key from another surface.
2. `REDIS_URL` provisioned and reachable in the target environment. Without Redis the assistant reports itself unavailable and refuses every turn (by design — the spend reservation is what makes a turn safe).
3. A signing secret: `openssl rand -base64 48`.
4. The pilot salon's slug.

Production environment variables, then redeploy:

| Variable | Value |
|---|---|
| `OWNER_ASSISTANT_ENABLED` | `true` |
| `OWNER_ASSISTANT_SALON_ALLOWLIST` | the pilot salon slug (comma-separated for more than one) |
| `OWNER_ASSISTANT_TOOLS` | `get_salon_overview,list_services,find_destination,diagnose_day_availability,get_setup_readiness` |
| `OPENAI_API_KEY_OWNER` | the dedicated key (Sensitive) |
| `OWNER_ASSISTANT_SIGNING_SECRET` | the generated secret (Sensitive) |
| `OWNER_ASSISTANT_MODEL` | optional; defaults to `gpt-5.6-luna` |
| `OWNER_ASSISTANT_REASONING_EFFORT` | optional; defaults to `low` |

Start with a subset of tools if a narrower first day is wanted: the allowlist is per tool, and an absent tool simply does not exist for the model.

## 4. Verification after enabling (no owner data touched)

1. **Still dark to the world:** an unauthenticated `GET /api/admin/owner-assistant/context?salonSlug=<any>` returns 401 (it proves only that the global switch is on; no salon is disclosed). With the switch off it is an empty 404.
2. **Entitlement is per salon:** from the pilot owner's own session, `context` for the pilot slug returns 200 with `model.available: true`; a second salon that same owner owns which is *not* on the allowlist returns an empty 404.
3. **Availability:** if `model.available` is false, the `reason` distinguishes `not_configured` (missing key, or missing signing secret in production) from `redis_unavailable` (no `REDIS_URL`).
4. **First turn:** ask "What services do I offer?" — the answer must carry a "Checked: your services list" line. Then ask "Why can't clients book Friday?" and a follow-up "What about Saturday?".
5. **Evidence landed:** `select created_at, metadata->'newValue' from salon_audit_log where salon_id = $1 and action = 'owner_assistant_turn' order by created_at desc limit 5;` — one row per turn with token counts, cost and the tools that ran, and no conversation text.

## 5. Spend controls, and how to confirm them

Two different mechanisms, and it is worth keeping them apart. **Redis** enforces the turn counters before any provider call, atomically in one Lua script: **30 turns per day** and **300 per month** **per salon**, and **2,000 turns per day** across all salons. The keys carry only the salon id (`…:salon:<salonId>:day:<UTC date>`), so the day and month allowance belongs to the salon, not to a person — **two owners of the same salon share one allowance**, and the same owner's two salons each get their own. The per-turn ceilings of **3 model calls** and **5 tool calls** are not Redis's at all: they are enforced in the turn loop (`OWNER_ASSISTANT_LIMITS.modelCallsPerTurn` / `toolCallsPerTurn` in `turn.server.ts`), inside a turn that has already reserved its single unit. A refused reservation costs nothing and the owner sees a plain "you've reached today's limit" sentence. The provider-side project budget is the backstop if Redis is ever flushed.

Expected pilot cost at the default model is roughly **$0.003 per turn**; one owner at 150 turns/month is about **$0.45–$1.50/month**. Confirm with the ledger report script over the pilot's rows rather than trusting the estimate.

## 6. During the pilot

- Watch the outcome mix in the ledger. `answer` should dominate; a run of `model_output_incomplete:max_output_tokens` means the output ceiling is too low for the questions being asked; `provider_error`/`provider_timeout` clusters mean the provider, not the salon.
- Read owner feedback rows (`action = 'owner_assistant_feedback'`). A thumbs-down with a report is the signal to read the matching turn's ledger row (which tools ran) and reproduce the question against the synthetic evaluation salon — never against the owner's data.
- Cost and latency evidence come from the ledger report, not from the provider console.

## 7. Turning it off

Per salon: remove the slug from `OWNER_ASSISTANT_SALON_ALLOWLIST` and redeploy. Globally: unset `OWNER_ASSISTANT_ENABLED` and redeploy — every route returns 404 immediately and the UI disappears. Neither loses data: the ledger and feedback rows remain.

Key rotation: replace `OPENAI_API_KEY_OWNER`, redeploy, then revoke the old key at the provider.

## 8. What this pilot does not cover

Reviewed write actions (nothing the assistant does can change data), the customer-facing "Help me choose" assistant, voice, any Stripe or billing surface, and any salon not named in the allowlist.
