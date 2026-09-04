import 'server-only';

import { currentUser } from '@clerk/nextjs/server';

import { formatPhoneE164 } from '@/libs/adminAuth';

import {
  type AuthenticatedOnboardingIdentity,
  OnboardingPersistenceError,
} from './persistence.server';

/**
 * Resolves the account-save identity from the active Clerk session. The
 * browser never supplies a user, admin, or salon id to this boundary.
 */
export async function requireAuthenticatedOnboardingIdentity(): Promise<AuthenticatedOnboardingIdentity> {
  const user = await currentUser();
  if (!user) {
    throw new OnboardingPersistenceError(
      'UNAUTHENTICATED',
      'Sign in to save your Luster site.',
      401,
    );
  }

  const primaryEmail = user.emailAddresses.find(
    address => address.id === user.primaryEmailAddressId,
  );
  if (!primaryEmail || primaryEmail.verification?.status !== 'verified') {
    throw new OnboardingPersistenceError(
      'EMAIL_NOT_VERIFIED',
      'Verify your email before saving your Luster site.',
      403,
    );
  }

  const primaryPhone = user.phoneNumbers.find(
    phone => phone.id === user.primaryPhoneNumberId,
  );
  let phoneE164: string | null = null;
  if (primaryPhone?.verification?.status === 'verified') {
    try {
      phoneE164 = formatPhoneE164(primaryPhone.phoneNumber);
    } catch {
      phoneE164 = null;
    }
  }

  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return {
    clerkUserId: user.id,
    email: primaryEmail.emailAddress.trim().toLowerCase(),
    name: name || null,
    phoneE164,
  };
}
