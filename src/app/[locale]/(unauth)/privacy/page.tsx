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
      updated="October 3, 2026"
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
            'When a salon owner connects Google Calendar, Luster stores the connected account email and Google account identifier and reads the list of calendars the owner can access. The owner chooses which calendar receives Luster appointments and which calendars Luster checks for booking conflicts.',
            'For those selected calendars, Luster reads free/busy time and event information made available by Google, such as event title, date and time, description, location, status, and attendee or client contact details when present in event data. Luster stores the event information in the salon workspace to display the schedule, let the owner review or convert selected events, and keep Luster-linked appointments synchronized when they change in either system.',
            'Google refresh tokens are encrypted at rest. Access is scoped to the connected salon, and Calendar data is not sold, transferred for advertising, or used to train generalized artificial intelligence or machine learning models.',
          ],
        },
        {
          title: 'Google API Services Limited Use',
          paragraphs: [
            'Luster’s use and transfer of information received from Google APIs to any other app adheres to the Google API Services User Data Policy, including the Limited Use requirements.',
            'For owner-connected Calendar accounts, Luster requests separate permissions to list calendars without changing them, read free and busy time, and read and synchronize event information on calendars the owner selects. Luster does not request Google’s full Calendar scope for this OAuth connection.',
            'Human access to Google user data is limited to the cases the Limited Use requirements permit: with the owner’s explicit consent, for security purposes, to comply with applicable law, or where the data has been aggregated and anonymized for internal operations.',
          ],
        },
        {
          title: 'Deleting Google data',
          paragraphs: [
            'A salon owner can disconnect Google Calendar at any time from the Luster workspace. Disconnecting asks Google to revoke Luster’s access and removes the stored OAuth connection, refresh token, connected account email, and connected account identifier. Calendar event information already synchronized into the salon workspace is not automatically removed when the connection is disconnected.',
            'Owners may also revoke Luster’s access directly from their Google Account permissions page. To request deletion of a Luster workspace and the salon records associated with it, email support@lustergel.app.',
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
