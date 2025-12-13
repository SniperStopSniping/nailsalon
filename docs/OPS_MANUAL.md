# Canvas OS Operations Manual

Exact procedures for operating the Canvas Flow OS in production.

---

## Table of Contents

1. [New Salon Onboarding](#new-salon-onboarding)
2. [Emergency Procedures](#emergency-procedures)
3. [Daily Monitoring](#daily-monitoring)
4. [Feature Flags](#feature-flags)
5. [Go/No-Go Checklist](#gono-go-checklist)

---

## New Salon Onboarding

### Step 1: Create Salon (Super Admin)

1. Log in as Super Admin
2. Navigate to Super Admin Dashboard
3. Create new organization/salon
4. Note the salon ID and slug

### Step 2: Assign Admin

1. Invite salon owner via phone number
2. Assign admin role to the owner
3. Verify admin can log in

### Step 3: Configure Policies

1. Navigate to `/{locale}/admin/policies`
2. Set photo requirements:
   - `requireBeforePhotoToStart`: off / optional / required
   - `requireAfterPhotoToFinish`: off / optional / required
   - `requireAfterPhotoToPay`: off / optional / required
3. Set autopost settings:
   - Enable/disable autopost
   - Select platforms (Instagram, Facebook)
   - Configure caption options
4. Save and verify "Saved" confirmation

### Step 4: Verify Before Photo Flow

1. Create test appointment
2. Start appointment flow
3. Upload "before" photo via staff app
4. Confirm photo appears in Cloudinary
5. Verify `appointment_artifacts.before_photo_url` is set

### Step 5: Verify After Photo + Autopost

1. Complete appointment to wrap_up state
2. Upload "after" photo
3. Confirm photo appears in Cloudinary
4. If autopost enabled:
   - Verify `autopost_queue` row created
   - Wait for cron to process
   - Verify post appears on Instagram/Facebook
5. Verify `appointment_artifacts.after_photo_url` is set

### Step 6: Sign-Off

- [ ] Admin can log in
- [ ] Policies saved
- [ ] Before photo works
- [ ] After photo works
- [ ] Autopost works (if enabled)

---

## Emergency Procedures

### Meta Token Invalid (Error Code 190)

**Symptoms:**
- Autopost jobs failing with "token_invalid"
- Meta error code 190 in job errors
- System Status shows Meta as configured but jobs fail

**Immediate Action:**

```bash
# 1. Disable autopost to stop queue processing
ENABLE_AUTOPOST_GLOBAL=false
# Deploy this change immediately
```

**Recovery:**

1. Go to Meta Business Suite → Settings → System Users
2. Generate new long-lived token with permissions:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `instagram_basic`
   - `instagram_content_publish`
3. Update `META_SYSTEM_USER_TOKEN` in environment
4. Re-enable autopost:
   ```bash
   ENABLE_AUTOPOST_GLOBAL=true
   ```
5. Deploy
6. Retry failed jobs from Super Admin → System Status

**Verification:**

```bash
curl https://your-domain.com/api/health
# Check: metaEnv: true
```

---

### Redis Outage

**Symptoms:**
- Photo upload presign/confirm returning 503
- Rate limiting not working
- Health check shows `redis: false`

**Immediate Action:**

```bash
# 1. Disable autopost (uses Redis for idempotency)
ENABLE_AUTOPOST_GLOBAL=false
# Deploy
```

**Note:** Photo uploads will fail (by design - fail closed). This is intentional to prevent duplicate uploads and queue spam.

**Recovery:**

1. Check Redis provider status:
   - Upstash: https://status.upstash.com/
   - Redis Labs: https://status.redis.com/
2. If Redis URL is wrong:
   - Update `REDIS_URL` in environment
   - Deploy
3. Wait for Redis to recover
4. Re-enable autopost:
   ```bash
   ENABLE_AUTOPOST_GLOBAL=true
   ```
5. Deploy

**Verification:**

```bash
curl https://your-domain.com/api/health
# Check: redis: true
```

---

### Queue Stuck

**Symptoms:**
- Jobs stuck in "processing" status for > 10 minutes
- No jobs being processed despite cron running
- Super Admin → System Status shows processing count > 0

**Diagnosis:**

1. Check Super Admin → System Status
2. Look for jobs stuck in "processing"
3. Check cron is running:
   - Vercel: Check Cron logs in dashboard
   - GitHub Actions: Check workflow runs

**Automatic Recovery:**

The worker has zombie protection. Jobs stuck in "processing" for > 10 minutes are automatically reset to "queued" on the next cron run.

**Manual Recovery (if automatic fails):**

1. Verify cron secret matches:
   ```bash
   # Test cron endpoint manually
   curl -X POST \
     -H "x-cron-secret: YOUR_SECRET" \
     https://your-domain.com/api/autopost/process
   ```

2. If cron works but jobs still stuck, use SQL (last resort):
   ```sql
   -- Reset stuck processing jobs
   UPDATE autopost_queue
   SET status = 'queued',
       error = 'manual_reset',
       processed_at = NOW()
   WHERE status = 'processing'
     AND processed_at < NOW() - INTERVAL '10 minutes';
   ```

3. Retry individual failed jobs from Super Admin → System Status

---

### Database Connection Issues

**Symptoms:**
- Health endpoint returns 503
- `db: false` in health check
- Application errors mentioning database

**Immediate Action:**

No immediate action needed - the app will fail gracefully.

**Recovery:**

1. Check database provider status:
   - Neon: https://neonstatus.com/
   - Supabase: https://status.supabase.com/
   - Vercel Postgres: https://www.vercel-status.com/
2. Verify `DATABASE_URL` is correct
3. Check connection limits (most providers have limits)
4. If using connection pooling, verify pooler URL

**Verification:**

```bash
curl https://your-domain.com/api/health
# Check: db: true, status: ok
```

---

## Daily Monitoring

**Time required:** 10-15 minutes

### 1. Check Health Endpoint

```bash
curl https://your-domain.com/api/health | jq
```

Expected:
```json
{
  "status": "ok",
  "checks": {
    "db": true,
    "redis": true,
    "cloudinaryEnv": true,
    "metaEnv": true,
    "cronSecretConfigured": true
  }
}
```

### 2. Check Failed Autoposts

1. Go to Super Admin → System Status
2. Review failed jobs count
3. For each failed job:
   - Check error message
   - If retryable, click Retry
   - If token issue, see [Meta Token Invalid](#meta-token-invalid-error-code-190)

### 3. Check Queue Backlog

1. Super Admin → System Status
2. Review queue summary:
   - Queued: Should be low (< 10 is healthy)
   - Processing: Should be 0 (unless cron just ran)
   - Failed: Review and retry if needed

### 4. Check Retry Counts

1. Failed jobs with retry count = 5 are exhausted
2. These need manual intervention:
   - Fix the underlying issue
   - Retry from Super Admin

---

## Feature Flags

### ENABLE_AUTOPOST_GLOBAL

**Purpose:** Global kill switch for autopost processing

**Values:**
- `true` (default): Autopost worker processes jobs
- `false`: Worker returns immediately without processing

**Usage:**
```bash
# Disable autopost
ENABLE_AUTOPOST_GLOBAL=false

# Re-enable autopost
ENABLE_AUTOPOST_GLOBAL=true
# or just remove the variable (defaults to true)
```

**When to use:**
- Meta API issues
- Redis outage
- Investigating queue problems
- Rate limit concerns

---

### MAX_PRESIGNS_PER_HOUR

**Purpose:** Rate limit for photo upload presign requests per tech

**Values:**
- Default: `50`
- Range: 1-1000 (practical)

**Usage:**
```bash
# Increase limit for high-volume salons
MAX_PRESIGNS_PER_HOUR=100

# Decrease for cost protection
MAX_PRESIGNS_PER_HOUR=25
```

**When to adjust:**
- Cloudinary cost concerns (decrease)
- High-volume salons hitting limits (increase)
- Suspected abuse (decrease)

---

### MAX_AUTOPOST_PER_RUN

**Purpose:** Maximum jobs processed per cron run

**Values:**
- Default: `20`
- Range: 1-100 (practical)

**Usage:**
```bash
# Process more jobs per run
MAX_AUTOPOST_PER_RUN=50

# Slow down processing
MAX_AUTOPOST_PER_RUN=10
```

---

## Go/No-Go Checklist

Before launching to production, all items must be checked:

### Infrastructure

- [ ] `/api/health` returns 200 with `status: ok`
- [ ] All health checks pass (db, redis, cloudinaryEnv, metaEnv, cronSecretConfigured)
- [ ] Dev routes blocked (`/canvas-demo` returns 404)

### Autopost

- [ ] One Instagram post succeeds (test account)
- [ ] One Facebook post succeeds (test account)
- [ ] Retry endpoint works (Super Admin → System Status → Retry)
- [ ] Kill switch tested:
  ```bash
  ENABLE_AUTOPOST_GLOBAL=false
  # Verify worker returns without processing
  ENABLE_AUTOPOST_GLOBAL=true
  ```

### Documentation

- [ ] `docs/LAUNCH_RUNBOOK.md` exists
- [ ] `docs/QA_CHECKLIST.md` exists
- [ ] `docs/OPS_MANUAL.md` exists (this file)

### Environment

- [ ] `scripts/verify-env.ts` passes:
  ```bash
  NODE_ENV=production npx tsx scripts/verify-env.ts
  ```

### Sign-Off

| Area | Verified By | Date |
|------|-------------|------|
| Infrastructure | | |
| Autopost | | |
| Documentation | | |
| Environment | | |

**Final Approval:** __________________ Date: __________

---

## Support Escalation

### Level 1: Self-Service
- Check this manual
- Check `docs/LAUNCH_RUNBOOK.md`
- Check Super Admin → System Status

### Level 2: Provider Status Pages
- Database: Check provider status
- Redis: Check provider status
- Meta: https://developers.facebook.com/status/

### Level 3: Code Investigation
- Check application logs
- Check Sentry for errors
- Review recent deployments
