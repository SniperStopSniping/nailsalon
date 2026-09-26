-- Existing test client profiles use the new default when they have no recorded
-- per-salon text refusal or provider STOP. The source identifies this as an
-- inferred test default, never an explicit customer selection.
-- Shared-sender STOP lives in its own log and still overrides these rows at
-- send time. The runtime sender identity is environment-owned, so this SQL
-- never tries to resolve or rewrite that log.
WITH eligible AS (
  SELECT DISTINCT sc.salon_id, sc.phone
  FROM salon_client sc
  WHERE sc.archived_at IS NULL
    AND sc.merged_into_client_id IS NULL
    AND sc.phone ~ '^[0-9]{10}$'
    AND NOT EXISTS (
      SELECT 1 FROM (
        SELECT DISTINCT ON (prior.purpose) prior.purpose, prior.status
        FROM communication_consent prior
        WHERE prior.salon_id = sc.salon_id
          AND prior.recipient = sc.phone
          AND prior.channel = 'sms'
          AND prior.purpose IN ('appointment_reminders', 'appointment_transactional', 'salon_promotions')
          AND prior.source <> 'twilio_inbound'
          AND coalesce(prior.metadata ->> 'bookingSmsMode', '') <> 'disabled'
        ORDER BY prior.purpose, prior.created_at DESC, prior.id DESC
      ) current_preference
      WHERE current_preference.status = 'revoked'
    )
    AND NOT EXISTS (
      SELECT 1 FROM (
        SELECT provider.status
        FROM communication_consent provider
        WHERE provider.salon_id = sc.salon_id
          AND provider.recipient = sc.phone
          AND provider.channel = 'sms'
          AND provider.purpose = 'appointment_transactional'
          AND provider.source = 'twilio_inbound'
        ORDER BY provider.created_at DESC, provider.id DESC
        LIMIT 1
      ) provider_preference
      WHERE provider_preference.status = 'revoked'
    )
), purposes AS (
  SELECT purpose FROM (VALUES ('appointment_reminders'), ('appointment_transactional'), ('salon_promotions')) AS p(purpose)
)
INSERT INTO communication_consent (id, salon_id, recipient, channel, purpose, status, wording_version, source, granted_at, metadata)
SELECT gen_random_uuid()::text, eligible.salon_id, eligible.phone, 'sms', purposes.purpose, 'granted',
  'existing-test-client-default-v1', 'test_client_default_backfill', now(),
  jsonb_build_object('selection', 'default_on', 'selectionWasExplicit', false, 'basis', 'existing_test_client_phone', 'migration', '0093')
FROM eligible CROSS JOIN purposes
WHERE NOT EXISTS (
  SELECT 1 FROM communication_consent existing
  WHERE existing.salon_id = eligible.salon_id
    AND existing.recipient = eligible.phone
    AND existing.channel = 'sms'
    AND existing.purpose = purposes.purpose
);
