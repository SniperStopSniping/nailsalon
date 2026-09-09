/** Salon-owned Twilio onboarding is retired; Luster provides credit-backed SMS. */
export async function GET(_request: Request) {
  return Response.json({ error: 'Luster texting uses SMS credits. Connecting or provisioning a separate Twilio account is not supported.' }, { status: 410 });
}
