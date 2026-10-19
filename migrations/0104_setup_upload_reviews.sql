-- Preserve existing conversation states; add review-only upload states.
-- No website, service, appointment or publication records are changed.
ALTER TABLE business_setup_turn
  DROP CONSTRAINT business_setup_turn_status_check,
  ADD CONSTRAINT business_setup_turn_status_check
    CHECK (status IN ('pending', 'generated', 'completed', 'failed', 'upload_review', 'upload_applied', 'upload_dismissed'));
