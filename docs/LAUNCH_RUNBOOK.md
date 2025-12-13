# Canvas OS Launch Runbook

Production deployment and operations guide for Canvas Flow OS.

---

## Table of Contents

1. [Required Environment Variables](#required-environment-variables)
2. [Cron Setup](#cron-setup)
3. [Health Verification](#health-verification)
4. [Recovery Procedures](#recovery-procedures)
5. [Verification Commands](#verification-commands)

---

## Required Environment Variables

### Database

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |

### Redis (Rate Limiting + Idempotency)

| Variable | Required | Description |
|----------|----------|-------------|
| `REDIS_URL` | Yes | Redis connection string (use `rediss://` for TLS) |

### Cloudinary (Photo Storage)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | Yes | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Yes | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Yes | Cloudinary API secret |

### Meta Graph API (Auto-Posting)

| Variable | Required | Description |
|----------|----------|-------------|
| `META_APP_ID` | Yes | Meta App ID |
| `META_APP_SECRET` | Yes | Meta App Secret |
| `META_SYSTEM_USER_TOKEN` | Yes | Long-lived system user token |
| `META_FACEBOOK_PAGE_ID` | Yes | Facebook Page ID to post to |
| `META_INSTAGRAM_ACCOUNT_ID` | Yes | Instagram Business Account ID |
| `META_GRAPH_VERSION` | No | Graph API version (default: `v19.0`) |

### Cron Worker

| Variable | Required | Description |
|----------|----------|-------------|
| `CRON_SECRET` | Yes | Secure random string for cron auth |

### Optional

| Variable | Required | Description |
|----------|----------|-------------|
| `LOGTAIL_SOURCE_TOKEN` | No | Logtail/BetterStack logging |
| `VERCEL_GIT_COMMIT_SHA` | No | Auto-set by Vercel for health endpoint |

---

## Cron Setup

The autopost worker must be triggered periodically to process queued jobs.

### Option A: Vercel Cron (Recommended)

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/autopost/process",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

**Note:** Vercel Cron automatically includes authentication headers. However, you should still set `CRON_SECRET` and verify it in the endpoint for defense in depth.

### Option B: GitHub Actions

Create `.github/workflows/autopost-cron.yml`:

```yaml
name: Autopost Worker

on:
  schedule:
    - cron: '*/5 * * * *' # Every 5 minutes
  workflow_dispatch: # Manual trigger

jobs:
  process:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger autopost worker
        run: |
          curl -X POST \
            -H "x-cron-secret: ${{ secrets.CRON_SECRET }}" \
            https://your-domain.com/api/autopost/process
```

### Option C: External Cron Service

Use any cron service (cron-job.org, EasyCron, etc.) to call:

```bash
POST https://your-domain.com/api/autopost/process
Header: x-cron-secret: YOUR_CRON_SECRET
```

---

## Health Verification

### Health Endpoint

```bash
curl https://your-domain.com/api/health
```

Expected response:

```json
{
  "status": "ok",
  "checks": {
    "db": true,
    "redis": true,
    "cloudinaryEnv": true,
    "metaEnv": true,
    "cronSecretConfigured": true
  },
  "timestamp": "2024-01-15T10:30:00.000Z",
  "gitSha": "abc1234"
}
```

### Status Codes

| Code | Meaning |
|------|---------|
| 200 | All systems operational |
| 503 | Database unreachable (degraded) |

### Uptime Monitoring

Configure your uptime monitor (UptimeRobot, Pingdom, etc.) to:

1. Check `GET /api/health`
2. Alert if status code != 200
3. Alert if `status` != "ok"
4. Check interval: 1-5 minutes

---

## Recovery Procedures

### Meta Token Invalid (Error Code 190)

**Symptoms:**
- Autopost jobs failing with "token_invalid" or Meta error code 190
- System status shows Meta as configured but jobs fail

**Recovery:**

1. Go to Meta Business Suite → Settings → System Users
2. Generate a new long-lived token with required permissions:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `instagram_basic`
   - `instagram_content_publish`
3. Update `META_SYSTEM_USER_TOKEN` in environment
4. Redeploy
5. Retry failed jobs from Super Admin → System Status

### Redis Outage

**Symptoms:**
- Photo upload presign/confirm returning 503
- Rate limiting not working

**Recovery:**

1. Check Redis provider status (Upstash, Redis Labs, etc.)
2. If Redis is down:
   - Uploads will fail (by design - fail closed)
   - Wait for Redis recovery
3. If Redis URL is wrong:
   - Update `REDIS_URL` in environment
   - Redeploy
4. Verify: `curl /api/health` should show `redis: true`

### Queue Stuck

**Symptoms:**
- Jobs stuck in "processing" status
- No jobs being processed despite cron running

**Diagnosis:**

1. Check Super Admin → System Status
2. Look for jobs stuck in "processing" > 10 minutes

**Recovery:**

Zombie protection runs automatically. If jobs are still stuck:

1. Check cron is running (Vercel Cron logs, GitHub Actions)
2. Check `CRON_SECRET` matches between env and cron config
3. Manually trigger worker:
   ```bash
   curl -X POST \
     -H "x-cron-secret: YOUR_SECRET" \
     https://your-domain.com/api/autopost/process
   ```
4. Check response for errors

### Database Connection Issues

**Symptoms:**
- Health endpoint returns 503
- `db: false` in health check

**Recovery:**

1. Check database provider status
2. Verify `DATABASE_URL` is correct
3. Check connection limits (Neon, Supabase, etc. have limits)
4. If using connection pooling, verify pooler URL

---

## Verification Commands

Run these before deploying to production:

```bash
# Lint check
npm run lint

# Type check
npm run check-types

# Build
npm run build

# Database migrations (development)
npm run db:migrate:dev

# Database migrations (production)
npm run db:migrate
```

### Pre-Deploy Checklist

- [ ] All environment variables set
- [ ] `npm run build` passes
- [ ] `npm run check-types` passes
- [ ] Database migrations applied
- [ ] Cron job configured
- [ ] Health endpoint accessible
- [ ] Meta token valid (test with Meta Graph API Explorer)

---

## Support Contacts

- **Database Issues:** Check provider status page
- **Redis Issues:** Check provider status page
- **Meta API Issues:** [Meta for Developers Status](https://developers.facebook.com/status/)
- **Vercel Issues:** [Vercel Status](https://www.vercel-status.com/)
