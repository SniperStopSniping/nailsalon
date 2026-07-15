import { SignIn, SignOutButton, SignUp } from '@clerk/nextjs';
import { clerkClient, currentUser } from '@clerk/nextjs/server';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { db } from '@/libs/DB';
import { hashOpaqueToken } from '@/libs/lusterSecurity';
import { salonSchema, salonSignupInviteSchema } from '@/models/Schema';

export const dynamic = 'force-dynamic';

export default async function JoinLusterPage({ params }: { params: { locale: string; token: string } }) {
  const [invite] = await db
    .select({
      invitedEmail: salonSignupInviteSchema.invitedEmail,
      intent: salonSignupInviteSchema.intent,
      salonName: salonSchema.name,
    })
    .from(salonSignupInviteSchema)
    .leftJoin(salonSchema, eq(salonSignupInviteSchema.salonId, salonSchema.id))
    .where(and(
      eq(salonSignupInviteSchema.tokenHash, hashOpaqueToken(params.token)),
      isNull(salonSignupInviteSchema.consumedAt),
      isNull(salonSignupInviteSchema.revokedAt),
      gt(salonSignupInviteSchema.expiresAt, new Date()),
    ))
    .limit(1);
  if (!invite) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
        <div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-stone-900">This invitation is no longer available</h1>
          <p className="mt-3 text-stone-600">Ask Luster for a new invite if this link expired or was already used.</p>
        </div>
      </main>
    );
  }

  const signedInUser = await currentUser();
  if (signedInUser) {
    const signedInEmails = signedInUser.emailAddresses
      .filter(email => email.verification?.status === 'verified')
      .map(email => email.emailAddress.trim().toLowerCase());
    if (signedInEmails.includes(invite.invitedEmail.trim().toLowerCase())) {
      redirect(`/${params.locale}/onboarding/luster?invite=${encodeURIComponent(params.token)}`);
    }
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
        <div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-stone-900">Switch to the invited account</h1>
          <p className="mt-3 text-stone-600">
            This invitation belongs to
            {' '}
            {invite.invitedEmail}
            . Sign out, then sign in with that email.
          </p>
          <SignOutButton redirectUrl={`/${params.locale}/join/${encodeURIComponent(params.token)}`}>
            <button type="button" className="mt-6 inline-flex rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white">
              Sign out and switch account
            </button>
          </SignOutButton>
        </div>
      </main>
    );
  }

  let accountExists = false;
  try {
    const client = await clerkClient();
    const users = await client.users.getUserList({
      emailAddress: [invite.invitedEmail],
      limit: 1,
    });
    accountExists = users.data.some(user => user.emailAddresses.some(
      email => email.emailAddress.trim().toLowerCase() === invite.invitedEmail.trim().toLowerCase(),
    ));
  } catch {
    // Clerk remains the source of truth. If account discovery is unavailable,
    // the sign-up form will still offer the existing-account sign-in route.
  }

  const redirectUrl = `/${params.locale}/onboarding/luster?invite=${encodeURIComponent(params.token)}`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-12">
      <div className="space-y-5 text-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">Luster Free Booking</p>
          <h1 className="mt-2 text-2xl font-semibold text-stone-900">
            {invite.intent === 'claim_existing' && invite.salonName
              ? `Finish setting up ${invite.salonName}`
              : accountExists ? 'Sign in to add this salon' : 'Create your owner account'}
          </h1>
          <p className="mt-2 text-sm text-stone-600">
            This invitation is for
            {invite.invitedEmail}
          </p>
        </div>
        {accountExists
          ? (
              <SignIn
                routing="hash"
                initialValues={{ emailAddress: invite.invitedEmail }}
                forceRedirectUrl={redirectUrl}
              />
            )
          : (
              <SignUp
                routing="hash"
                initialValues={{ emailAddress: invite.invitedEmail }}
                forceRedirectUrl={redirectUrl}
              />
            )}
      </div>
    </main>
  );
}
