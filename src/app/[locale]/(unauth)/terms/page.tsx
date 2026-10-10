import type { Metadata } from 'next';

import { LusterLegalPage } from '@/components/legal/LusterLegalPage';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms for using Luster free booking and salon tools.',
};

export default function TermsPage() {
  return (
    <LusterLegalPage
      title="Terms of Service"
      updated="October 10, 2026"
      intro="These terms apply when a salon owner or customer uses Luster booking pages, owner workspaces, appointment tools, or optional integrations."
      sections={[
        {
          title: 'The Luster service',
          paragraphs: [
            'Luster provides booking, customer relationship, service, schedule, and integration tools for nail professionals. Salons remain responsible for their services, prices, schedules, customer relationships, and legal obligations.',
          ],
        },
        {
          title: 'Accounts and access',
          paragraphs: [
            'Salon owners must provide accurate account information, keep credentials secure, and use only salons they are authorized to manage. Customer appointment-management links are private capability links and must not be shared publicly.',
          ],
        },
        {
          title: 'Google Calendar and messaging',
          paragraphs: [
            'Google Calendar is optional. A connected owner chooses which calendars Luster may use to check availability and display events, and which calendar receives Luster appointments. Luster can synchronize Luster-linked appointments and show selected events for owner review or conversion. Owners can disconnect the integration at any time; event information already synchronized into the salon workspace is not automatically removed on disconnect.',
            'Twilio messaging is optional and salon-funded. Messaging failures must never be treated as proof that a booking failed; the Luster appointment record remains the source of truth.',
          ],
        },
        {
          title: 'Acceptable use',
          paragraphs: [
            'Users may not misuse the service, access another salon, send unlawful messages, interfere with security, or use customer appointment consent for unrelated marketing.',
          ],
        },
        {
          title: 'Availability and changes',
          paragraphs: [
            'Luster may improve, limit, or discontinue features and may suspend abusive or unsafe use. We work to keep bookings available, but third-party integrations and internet services may occasionally be unavailable.',
          ],
        },
        {
          title: 'Responsibility',
          paragraphs: [
            'To the extent permitted by law, Luster is provided without guarantees that every integration or delivery provider will always be available. Nothing in these terms limits rights that cannot legally be limited.',
          ],
        },
      ]}
    />
  );
}
