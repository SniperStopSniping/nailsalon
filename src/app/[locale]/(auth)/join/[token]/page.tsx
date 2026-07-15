import { SignUp } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
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

  const { userId } = await auth();
  if (userId) {
    redirect(`/${params.locale}/onboarding/luster?invite=${encodeURIComponent(params.token)}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-12">
      <div className="space-y-5 text-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-700">Luster Free Booking</p>
          <h1 className="mt-2 text-2xl font-semibold text-stone-900">
            {invite.intent === 'claim_existing' && invite.salonName
              ? `Finish setting up ${invite.salonName}`
              : 'Create your owner account'}
          </h1>
          <p className="mt-2 text-sm text-stone-600">
            This invitation is for
            {invite.invitedEmail}
          </p>
        </div>
        <SignUp
          routing="hash"
          initialValues={{ emailAddress: invite.invitedEmail }}
          forceRedirectUrl={`/${params.locale}/onboarding/luster?invite=${encodeURIComponent(params.token)}`}
        />
      </div>
    </main>
  );
}
