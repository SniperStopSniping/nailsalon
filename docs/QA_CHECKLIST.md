# Canvas OS QA Checklist

Pre-launch quality assurance checklist for Canvas Flow OS features.

---

## Photo Upload Flow

### Before Photo (Start Service Gate)

- [ ] **Presign Request**
  - [ ] Request presign for "before" photo
  - [ ] Verify presign returns `uploadUrl` and `objectKey`
  - [ ] Verify presign expires after 15 minutes

- [ ] **Upload to Cloudinary**
  - [ ] Upload image to presigned URL
  - [ ] Verify upload succeeds

- [ ] **Confirm Upload**
  - [ ] Call confirm endpoint with `objectKey`
  - [ ] Verify `appointment_artifacts.before_photo_url` is set
  - [ ] Verify `before_photo_uploaded_at` timestamp is set

- [ ] **State Machine Gate**
  - [ ] With policy `requireBeforePhotoToStart: required`:
    - [ ] Transition `waiting → working` blocked without photo
    - [ ] Transition `waiting → working` allowed after photo upload
  - [ ] With policy `requireBeforePhotoToStart: optional`:
    - [ ] Transition `waiting → working` allowed without photo

### After Photo (Complete Gate)

- [ ] **Presign Request**
  - [ ] Request presign for "after" photo
  - [ ] Verify presign returns `uploadUrl` and `objectKey`

- [ ] **Upload to Cloudinary**
  - [ ] Upload image to presigned URL
  - [ ] Verify upload succeeds

- [ ] **Confirm Upload**
  - [ ] Call confirm endpoint with `objectKey`
  - [ ] Verify `appointment_artifacts.after_photo_url` is set
  - [ ] Verify `after_photo_uploaded_at` timestamp is set

- [ ] **State Machine Gate**
  - [ ] With policy `requireAfterPhotoToFinish: required`:
    - [ ] Transition `wrap_up → complete` blocked without photo
    - [ ] Transition `wrap_up → complete` allowed after photo upload

---

## Autopost Queue

### Enqueue on After Photo

- [ ] **With autopost enabled:**
  - [ ] Confirm "after" photo
  - [ ] Verify `autopost_queue` row created
  - [ ] Verify `status = 'queued'`
  - [ ] Verify `platform` matches policy platforms
  - [ ] Verify `payload_json` contains:
    - [ ] `appointmentId`
    - [ ] `salonId`
    - [ ] `salonName`
    - [ ] `afterPhotoObjectKey`
    - [ ] `includePrice`, `includeColor`, `includeBrand`
    - [ ] `aiCaptionEnabled`

- [ ] **With autopost disabled:**
  - [ ] Confirm "after" photo
  - [ ] Verify NO `autopost_queue` row created

### Worker Processing

- [ ] **Success Flow**
  - [ ] Trigger worker: `POST /api/autopost/process` with cron secret
  - [ ] Verify queued job moves to `processing`
  - [ ] Verify job moves to `posted` on success
  - [ ] Verify `payload_json.externalPostId` is set

- [ ] **Failure Flow**
  - [ ] Simulate failure (e.g., invalid token)
  - [ ] Verify job moves to `failed`
  - [ ] Verify `retryCount` increments
  - [ ] Verify `error` message is set

- [ ] **Retry Limit**
  - [ ] After 5 failures, verify job is NOT retried
  - [ ] Verify `retryCount = 5`

---

## Admin Retry Endpoint

- [ ] **Super Admin Only**
  - [ ] Non-admin request returns 403
  - [ ] Super admin request succeeds

- [ ] **Retry Behavior**
  - [ ] Retry failed job via `POST /api/super-admin/autopost/retry`
  - [ ] Verify `status` changes to `queued`
  - [ ] Verify `retryCount` resets to 0
  - [ ] Verify `error` is cleared
  - [ ] Verify `scheduledFor` is null
  - [ ] Verify job is picked up by next worker run

- [ ] **Invalid Status**
  - [ ] Attempt to retry `posted` job
  - [ ] Verify returns 409 error

---

## Dev Route Blocking

- [ ] **Development Environment**
  - [ ] `/canvas-demo` is accessible
  - [ ] Page renders correctly

- [ ] **Production Environment**
  - [ ] Set `NODE_ENV=production`
  - [ ] `/canvas-demo` returns 404
  - [ ] No error page or stack trace exposed

---

## Health Endpoint

- [ ] **Basic Health**
  - [ ] `GET /api/health` returns 200
  - [ ] Response includes `status: "ok"`
  - [ ] Response includes all checks

- [ ] **Database Down**
  - [ ] Simulate DB failure
  - [ ] Verify returns 503
  - [ ] Verify `status: "degraded"`
  - [ ] Verify `checks.db: false`

- [ ] **Redis Down**
  - [ ] Unset `REDIS_URL`
  - [ ] Verify `checks.redis: false`
  - [ ] Verify overall status still "ok" (Redis is optional)

---

## System Status Page

- [ ] **Access Control**
  - [ ] Non-admin cannot access
  - [ ] Super admin can access

- [ ] **Environment Display**
  - [ ] Shows Meta configured status
  - [ ] Shows Cloudinary configured status
  - [ ] Shows Redis configured status
  - [ ] Shows Cron Secret configured status
  - [ ] Does NOT show actual secrets

- [ ] **Queue Summary**
  - [ ] Shows counts by status
  - [ ] Counts match database

- [ ] **Failed Jobs Table**
  - [ ] Shows last 10 failed jobs
  - [ ] Shows platform, error, retry count
  - [ ] Retry button works
  - [ ] Shows success/error message after retry

---

## Policy Dashboards

### Super Admin Policies

- [ ] **Access**
  - [ ] Super admin can access `/super-admin/policies`
  - [ ] Non-admin redirected

- [ ] **Save**
  - [ ] Change photo requirements
  - [ ] Change autopost settings
  - [ ] Click Save
  - [ ] Verify toast/confirmation
  - [ ] Refresh page, verify settings persisted

### Salon Admin Policies

- [ ] **Access**
  - [ ] Salon admin can access `/admin/policies`
  - [ ] Non-admin redirected

- [ ] **Effective Preview**
  - [ ] Shows resolved policy
  - [ ] Shows source badges (SA Forced / Salon / Default)
  - [ ] Updates in real-time as form changes

- [ ] **Super Admin Override**
  - [ ] Set super admin policy
  - [ ] Verify salon cannot override forced settings
  - [ ] Verify effective preview shows "SA Forced"

---

## Idempotency

- [ ] **Confirm Endpoint**
  - [ ] Send confirm request with `Idempotency-Key`
  - [ ] Send same request again with same key
  - [ ] Verify second request returns cached response
  - [ ] Verify NO duplicate `autopost_queue` rows

- [ ] **Rate Limiting**
  - [ ] Send 100 presign requests
  - [ ] Send 101st request
  - [ ] Verify returns 429

---

## Edge Cases

- [ ] **Expired Presign**
  - [ ] Wait 15+ minutes after presign
  - [ ] Attempt confirm
  - [ ] Verify returns 409 "presign_expired_or_invalid"

- [ ] **Object Key Mismatch**
  - [ ] Get presign for "before"
  - [ ] Attempt confirm with wrong `objectKey`
  - [ ] Verify returns 409 "object_key_mismatch"

- [ ] **Upload Not Found**
  - [ ] Get presign
  - [ ] Attempt confirm WITHOUT uploading
  - [ ] Verify returns 409 "upload_not_found"

---

## Sign-Off

| Area | Tester | Date | Pass/Fail |
|------|--------|------|-----------|
| Photo Upload Flow | | | |
| Autopost Queue | | | |
| Admin Retry | | | |
| Dev Route Blocking | | | |
| Health Endpoint | | | |
| System Status Page | | | |
| Policy Dashboards | | | |
| Idempotency | | | |
| Edge Cases | | | |

**Final Approval:** __________________ Date: __________
