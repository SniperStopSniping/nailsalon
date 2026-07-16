import type { Metadata } from 'next';

import { LusterLegalPage } from '@/components/legal/LusterLegalPage';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Luster protects salon, customer, and Google Calendar data.',
};

export default function PrivacyPage() {
  return (
    <LusterLegalPage
      title="Privacy Policy"
      updated="July 15, 2026"
      intro="Luster provides free salon booking and CRM tools for nail professionals. This policy explains the information we process to operate booking pages, owner workspaces, appointment communications, and optional integrations."
      sections={[
        {
          title: 'Information we process',
          paragraphs: [
            'We process salon profile details, services, availability, owner account information, and customer contact and appointment information supplied through Luster.',
            'Customer phone numbers are contact information and are not treated as verified identity. Transactional texting is optional and requires separate consent.',
          ],
        },
        {
          title: 'Google Calendar data',
          paragraphs: [
            'When a salon owner connects Google Calendar, Luster reads calendar lists and free/busy information and creates or updates Luster-linked appointment events. Calendar access is used only to prevent booking conflicts and keep appointments synchronized.',
            'Google refresh tokens are encrypted. Access is scoped to the connected salon, and Calendar data is not sold or used for advertising.',
          ],
        },
        {
          title: 'How information is used',
          paragraphs: [
            'Information is used to provide bookings, salon CRM tools, reminders, appointment management links, security, support, and integration health. Luster product marketing to owners requires separate consent.',
          ],
        },
        {
          title: 'Service providers and retention',
          paragraphs: [
            'Luster uses infrastructure and account, email, Calendar, and optional messaging providers only as needed to operate the service. Access tokens, passwords, session cookies, and appointment capability tokens are never exposed through public salon APIs.',
            'Information is retained only as long as needed for the service, legal obligations, security, and legitimate salon records. Owners may disconnect Google Calendar at any time from their Luster workspace.',
          ],
        },
        {
          title: 'Your choices',
          paragraphs: [
            'Salon owners can update salon information, disconnect integrations, and request account or data support. Customers can use their secure appointment-management link to reschedule or cancel without creating an account.',
          ],
        },
      ]}
    />
  );
}
