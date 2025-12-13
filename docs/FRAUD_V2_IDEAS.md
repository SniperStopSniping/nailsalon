# Fraud Signal System v2 Ideas

> **DO NOT IMPLEMENT DURING v1 EXECUTION**
> This is a parking lot for future improvements. v1 must ship first.

---

## Phase 2 Features

### Same Device / Phone Pattern Detection
- Multiple clients using same phone
- Multiple accounts linked to same device fingerprint
- Requires device fingerprint collection (later phase)

### Salon Average Comparison
- Compare client points to salon weekly average
- Requires rolling `salonWeeklyPointsAvg` computed nightly
- More accurate than absolute cap for low-volume salons

### Client's Own History Comparison
- Flag if client's current week is >2x their last-4-weeks average
- More personalized than salon-wide or absolute thresholds

### Super Admin Fraud Dashboard
- Global fraud dashboard with filters
- Filter by: salon, client, severity, type, date range
- Bulk resolve capability
- Export functionality

### Advanced Throttle Options
- Option to throttle even after resolve (configurable per salon)
- Configurable throttle windows per salon
- "Permanent ignore" option for known-good patterns (promo models, etc.)

### Notification System
- Email/SMS to salon owner when HIGH severity signal created
- Weekly digest of unresolved signals
- Configurable notification preferences

### Audit Trail Enhancements
- Track who viewed signals (not just resolved)
- Track signal state changes over time
- Link signals to audit log for compliance

### Refund-Aware Velocity
- Track refunds and subtract from velocity calculations
- Requires refund tracking in appointment or separate table

### Multi-Location Patterns
- Detect same client booking across multiple locations
- Flag unusual cross-location patterns

### Tech-Level Fraud Detection
- Flag if single technician has unusually high points-per-client
- Detect tech gaming points on fake clients

---

## Performance Optimizations

### Materialized Views
- Pre-compute 7d/14d counts per client
- Refresh on schedule or after batch completions

### Background Processing
- Move fraud evaluation to background job queue
- Reduce completion endpoint latency

### Caching
- Cache unresolved signal counts per salon
- Invalidate on signal create/resolve

---

## Schema Changes (v2)

### Add to fraud_signal
- `viewedAt` / `viewedBy` for audit
- `escalatedAt` / `escalatedTo` for severity escalation
- `linkedSignalId` for grouping related signals

### Add salonClientId to appointment (DONE in v1)
- Phase 1.5: Make NOT NULL after backfill verified

---

## Notes
- All v2 features require v1 to be stable in production first
- Prioritize based on actual fraud patterns observed post-v1
