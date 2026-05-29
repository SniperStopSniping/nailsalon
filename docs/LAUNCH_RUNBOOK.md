# Nail Salon SaaS Launch Runbook

Production deployment and operations guide for the multi-tenant salon platform.

## Required Environment Variables

### Blocking launch requirements

| Variable | Why it matters |
| --- | --- |
| `NODE_ENV=production` | Required for true production behavior |
| `DATABASE_URL` | Primary Postgres connection |
| `NEXT_PUBLIC_APP_URL` | Used for redirects, billing flows, and outbound links |
| `CRON_SECRET` | Auth for cron endpoints |
| `TWILIO_ACCOUNT_SID` | Phone-first OTP auth and SMS delivery |
| `TWILIO_AUTH_TOKEN` | Phone-first OTP auth and SMS delivery |
| `TWILIO_VERIFY_SERVICE_SID` | OTP verification |
| `TWILIO_PHONE_NUMBER` | Reminder and notification SMS sends |
| `STRIPE_SECRET_KEY` | Subscription billing |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Billing client flows |
| `NEXT_PUBLIC_SENTRY_DSN` | Strict production build guard |
| `SENTRY_ORG` | Strict production build guard |
| `SENTRY_PROJECT` | Strict production build guard |
| `SENTRY_AUTH_TOKEN` | Strict production build guard |

### Recommended for a polished managed launch

| Variable | Why it matters |
| --- | --- |
| `REDIS_URL` | Stronger rate limiting, booking idempotency, replay protection |
| `CLOUDINARY_CLOUD_NAME` | Durable public photo and avatar storage |
| `CLOUDINARY_API_KEY` | Durable public photo and avatar storage |
| `CLOUDINARY_API_SECRET` | Durable public photo and avatar storage |
| `RESEND_API_KEY` | Owner/technician transactional email notifications |
| `RESEND_FROM_EMAIL` | Owner/technician transactional email notifications |
| `META_SYSTEM_USER_TOKEN` | Needed only if auto-posting is enabled |
| `META_FACEBOOK_PAGE_ID` | Needed only if Facebook auto-posting is enabled |
| `META_INSTAGRAM_ACCOUNT_ID` | Needed only if Instagram auto-posting is enabled |

## Pre-Deploy Verification

Run these before treating a deployment as launch-ready:

```bash
npm run check-types
npm run ops:verify:launch
npm run db:migrate
```

Notes:
- `npm run ops:verify:launch` checks the repo’s actual launch env assumptions.
- `npm run db:migrate` applies pending Drizzle SQL migrations using the production dotenv profile.
- Migrations are **not** run automatically during build or deploy.

## Cron Setup

### Active in `vercel.json`

The repo currently ships one live cron:

```json
{
  "path": "/api/reminders/process",
  "schedule": "*/15 * * * *"
}
```

This powers:
- day-before appointment reminders
- same-day appointment reminders

### Optional cron if auto-posting is enabled

Auto-posting still exists in the app, but its cron is **not** currently enabled in `vercel.json`.

If you want live autopost processing, add:

```json
{
  "path": "/api/autopost/process",
  "schedule": "*/5 * * * *"
}
```

## Production Rollout Order

1. Set production environment variables in Vercel.
2. Run `npm run ops:verify:launch`.
3. Run `npm run db:migrate`.
4. Deploy or redeploy Vercel.
5. Confirm `/api/health` returns `200` and the expected integration flags.
6. Verify one real booking end to end:
   - customer OTP works
   - booking succeeds
   - technician/owner notifications work if enabled
7. Verify one reminder flow:
   - a test appointment enters the reminder window
   - the cron route updates reminder fields only once
8. Verify billing:
   - checkout session can be created
   - webhook updates salon subscription state
9. Verify media:
   - live staff avatar upload stores a durable public URL
   - public booking page renders that avatar

## Health Verification

The public health endpoint is:

```bash
curl https://your-domain.com/api/health
```

The response reports:
- database connectivity
- Redis presence
- Cloudinary config presence
- Meta config presence
- cron secret presence
- Twilio config presence
- Resend config presence
- Stripe config presence
- Sentry config presence

Rules:
- database failure returns `503`
- missing optional integrations do **not** degrade the endpoint to `503`
- missing optional integrations still indicate reduced SaaS readiness

## Operational Recovery Notes

### Build blocked before deploy

If `next build` fails in production mode with Sentry errors:
- verify `NEXT_PUBLIC_SENTRY_DSN`
- verify `SENTRY_ORG`
- verify `SENTRY_PROJECT`
- verify `SENTRY_AUTH_TOKEN`

### Booking emails missing

Check:
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- verified sender/domain in Resend

### OTP or SMS reminders failing

Check:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VERIFY_SERVICE_SID`
- `TWILIO_PHONE_NUMBER`

### Public avatars not rendering

Check:
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- stored avatar URL is a public `https://...` URL, not `/uploads/...`
