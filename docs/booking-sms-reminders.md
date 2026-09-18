# Appointment SMS reminders during public booking

The salon's `settings.communications.sms.bookingDefault` accepts `default_on`,
`default_off`, or `disabled`. Missing settings resolve to `default_on`. This
controls the public booking choice independently from existing sender, credit,
platform, and salon delivery gates. Saving it does not update client records.

The required phone field is followed by Text reminders. The default-on choice is
checked; default-off is unchecked; disabled hides the choice. A temporarily
unavailable sender does not hide the preference. The checkbox label is a minimum
44px tap target. English and French copy explain turning texts off and STOP.

Submissions append records to the existing `communication_consent` table under
purpose `appointment_reminders`. Metadata records the appointment ID, one of
`default_on`, `default_off`, `explicit_on`, or `explicit_off`, and whether the
selection was explicit. Untouched defaults are never recorded as explicit
checkbox consent. Known older default-off booking forms remain compatible.

Checked submissions can enable appointment reminders for an existing client
whose prior checkbox choice was off. Unchecked submissions disable them. A
booking-specific disabled record also prevents a later booking from reviving
texts for that earlier appointment. Historical appointments without these new
records retain their existing transactional-consent fallback.

STOP is independent of booking preference. Shared sender suppression and
provider-originated local STOP records take precedence, including Twilio 21610
provider rejection evidence. A booking cannot clear these records. A suppressed
submission retains its requested selection as audit evidence. Twilio 30007 is
shown as a provider block, not customer opt-out. No phone-status lookup is exposed
on the public form; the successful booking response reports its effective state.

Owner client and appointment SMS panels show customer-disabled and opted-out
preferences even without a queued message. Delivery history distinguishes those
states from provider blocking, send failure, sent, and delivered. Email remains
on its existing independent fallback path. Review and promotional eligibility
continue to use their existing consent stream; reminder choices do not grant it.

No schema migration or historical preference backfill is required. This change
does not activate platform delivery, alter credits, or send real test messages.
