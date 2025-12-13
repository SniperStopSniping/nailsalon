# Migration & Verification Scripts

## Migration Strategy: Raw SQL with Idempotent Guards

This project uses **raw SQL migrations** for schema changes, with the following principles:

1. **All DDL statements are idempotent** (safe to re-run):
   - `CREATE TABLE IF NOT EXISTS`
   - `CREATE INDEX IF NOT EXISTS`
   - `ADD COLUMN IF NOT EXISTS`
   - `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN ... END $$;` for enums

2. **Drizzle is used for ORM only**, not for migration state tracking.

3. **Migration tracking**: Not enforced via DB table. Instead:
   - Migration files are numbered (`0034_*.sql`)
   - Re-running is safe due to idempotent guards
   - Verification scripts check actual schema state

## Scripts

### 1. Run a Migration

```bash
# Direct SQL execution (idempotent - safe to re-run)
NODE_ENV=development npx dotenv -c development -- npx tsx -e "
import pg from 'pg';
import fs from 'fs';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sql = fs.readFileSync('./migrations/0034_add_fraud_signal_system.sql', 'utf8');
await pool.query(sql);
console.log('Migration complete');
await pool.end();
"
```

### 2. Verify Schema

```bash
NODE_ENV=development npx dotenv -c development -- npx tsx scripts/verify-fraud-schema.ts
```

This verifies:
- All required columns exist
- All required tables exist
- All required indexes exist
- No orphaned foreign keys
- No cross-tenant data corruption

**Exit code 0** = all checks pass, **1** = critical failure.

### 3. Backfill Data

```bash
# Dry run first
NODE_ENV=development npx dotenv -c development -- npx tsx scripts/backfill-appointment-salon-client-id.ts --dry-run

# Live run
NODE_ENV=development npx dotenv -c development -- npx tsx scripts/backfill-appointment-salon-client-id.ts

# Strict mode (exit 1 if any unmatched)
NODE_ENV=development npx dotenv -c development -- npx tsx scripts/backfill-appointment-salon-client-id.ts --strict
```

The backfill script:
- Only runs in `NODE_ENV=development`
- Prints masked DATABASE_URL at start
- Runs actual verification queries after completion
- Checks for orphans and cross-tenant mismatches

### 4. Smoke Test Fraud System

```bash
NODE_ENV=development npx dotenv -c development -- npx tsx scripts/smoke-test-fraud-system.ts
```

This is a **DB-based test** (not console.log based). It:
- Queries actual fraud_signal rows
- Checks for duplicate signals
- Verifies FK integrity
- Reports on unresolved vs resolved counts

## Important Notes

### Database URL

All scripts print the masked DATABASE_URL at startup:
```
Database: postgresql://***:***@ep-patient-wind-a404fmqu-pooler.us-east-1.aws.neon.tech/neondb?...
```

This prevents accidentally running against the wrong database.

### Idempotency

All operations are designed to be idempotent:
- Migrations use `IF NOT EXISTS` / `EXCEPTION WHEN duplicate_object`
- Backfill uses `WHERE salon_client_id IS NULL`
- Fraud signal creation uses `ON CONFLICT (appointment_id, type) DO NOTHING`

### Safety Checks

1. **NODE_ENV check**: Backfill only runs in `development`
2. **DATABASE_URL required**: Scripts fail fast if not set
3. **Pre-flight checks**: Backfill verifies unique constraints exist
4. **Post-run verification**: Backfill runs actual queries to verify data integrity

## CI/CD Integration

For CI/CD, use `--strict` flag on backfill:

```yaml
# Example GitHub Actions step
- name: Run backfill
  run: |
    NODE_ENV=development npx dotenv -c development -- npx tsx scripts/backfill-appointment-salon-client-id.ts --strict
```

This exits non-zero if any appointments couldn't be matched.

## Troubleshooting

### "Migration didn't apply"

If `verify-fraud-schema.ts` shows missing columns/tables:
1. Check you're using the correct DATABASE_URL
2. Run the migration SQL directly (it's idempotent)
3. Re-run verification

### "Cross-tenant mismatch found"

This is a **critical** data integrity issue. Do not proceed until resolved.
Query to find offending rows:
```sql
SELECT a.id, a.salon_id, sc.salon_id as sc_salon_id
FROM appointment a 
JOIN salon_client sc ON sc.id = a.salon_client_id 
WHERE a.salon_id <> sc.salon_id;
```

### "Orphaned salon_client_id"

This shouldn't happen due to FK constraint. If it does:
```sql
UPDATE appointment SET salon_client_id = NULL WHERE salon_client_id NOT IN (SELECT id FROM salon_client);
```
