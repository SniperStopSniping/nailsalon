const clerk = vi.hoisted(() => ({ currentUser: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@clerk/nextjs/server', () => ({ currentUser: clerk.currentUser }));

/* eslint-disable import/first */
import { requireAuthenticatedOnboardingIdentity } from './identity.server';
/* eslint-enable import/first */

describe('requireAuthenticatedOnboardingIdentity', () => {
  it('resolves only the active Clerk user and verified primary email', async () => {
    clerk.currentUser.mockResolvedValue({
      emailAddresses: [{
        emailAddress: ' Daniela@Example.Test ',
        id: 'email_primary',
        verification: { status: 'verified' },
      }],
      firstName: 'Daniela',
      id: 'user_daniela',
      lastName: 'Isla',
      phoneNumbers: [],
      primaryEmailAddressId: 'email_primary',
      primaryPhoneNumberId: null,
    });

    await expect(requireAuthenticatedOnboardingIdentity()).resolves.toEqual({
      clerkUserId: 'user_daniela',
      email: 'daniela@example.test',
      name: 'Daniela Isla',
      phoneE164: null,
    });
  });

  it('keeps phone optional and normalizes it only when Clerk verified it', async () => {
    clerk.currentUser.mockResolvedValue({
      emailAddresses: [{
        emailAddress: 'daniela@example.test',
        id: 'email_primary',
        verification: { status: 'verified' },
      }],
      firstName: null,
      id: 'user_email_only',
      lastName: null,
      phoneNumbers: [{
        id: 'phone_primary',
        phoneNumber: '+1 (416) 555-0100',
        verification: { status: 'verified' },
      }],
      primaryEmailAddressId: 'email_primary',
      primaryPhoneNumberId: 'phone_primary',
    });

    await expect(requireAuthenticatedOnboardingIdentity()).resolves.toMatchObject({
      clerkUserId: 'user_email_only',
      phoneE164: '+14165550100',
    });
  });

  it('rejects missing sessions and unverified primary email', async () => {
    clerk.currentUser.mockResolvedValueOnce(null);

    await expect(requireAuthenticatedOnboardingIdentity()).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });

    clerk.currentUser.mockResolvedValueOnce({
      emailAddresses: [{
        emailAddress: 'daniela@example.test',
        id: 'email_primary',
        verification: { status: 'unverified' },
      }],
      id: 'user_unverified',
      phoneNumbers: [],
      primaryEmailAddressId: 'email_primary',
      primaryPhoneNumberId: null,
    });

    await expect(requireAuthenticatedOnboardingIdentity()).rejects.toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
      status: 403,
    });
  });
});
