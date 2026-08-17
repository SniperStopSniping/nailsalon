/**
 * Secure short appointment-management links — Gate B owner-approved addition.
 *
 * DESIGN: an ALIAS onto the existing appointment_access_token capability,
 * not a second authorization model. Minting stores only
 * hashOpaqueToken(token) in the EXISTING table, so expiry, revocation,
 * the max-3-active cap and salon+appointment scoping all apply unchanged;
 * resolution is the same digest lookup the long /manage path uses.
 *
 * Token: 16 random bytes → 22-char base64url → 128 bits of entropy (the
 * contract's preferred level; 96-bit floor). Opaque — no appointment, salon
 * or PII embedded. The raw token is returned exactly once at mint time and
 * never logged or persisted.
 *
 * The link host is a SINGLE fixed Luster-owned origin — NEVER the salon's
 * custom domain (a tenant-supplied host would receive the capability token
 * cross-origin, and an unbounded host breaks the one-segment proof). The
 * one-segment budget requires origin + '/a/' ≤ 34 characters, i.e. host ≤
 * SHORT_LINK_MAX_HOST_LENGTH; the template suite enforces this against the
 * configured origin.
 *
 * INERT IN GATE B: no production call site mints these links. Call-site
 * migration is Gate C.
 */

import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import type { db as appDb } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { hashOpaqueToken } from '@/libs/lusterSecurity';
import {
  appointmentAccessTokenSchema,
  salonSchema,
} from '@/models/Schema';

import type { BillingDbTransaction } from './billing/creditLedger';

type DbExecutor = BillingDbTransaction | typeof appDb;

export const SHORT_LINK_TOKEN_BYTES = 16; // 128 bits
export const SHORT_LINK_TOKEN_LENGTH = 22; // base64url of 16 bytes
export const SHORT_LINK_PATH_PREFIX = '/a/';
/** origin + '/a/' must fit the one-segment budget: 34 chars ⇒ host ≤ 23. */
export const SHORT_LINK_MAX_ORIGIN_LENGTH = 31;

export function resolveShortLinkOrigin(): string {
  const configured = Env.LUSTER_SHORT_LINK_ORIGIN;
  if (configured && configured.length > 0) {
    return configured.replace(/\/$/, '');
  }
  return 'https://islanailsalon.com';
}

export function buildShortManageUrl(token: string): string {
  return `${resolveShortLinkOrigin()}${SHORT_LINK_PATH_PREFIX}${token}`;
}

/**
 * Mint a short-link capability for an appointment: a fresh 128-bit token
 * whose digest lands in appointment_access_token exactly like a long
 * manage token (same expiry semantics as mintAppointmentManageLink's rows;
 * the caller supplies expiry policy).
 */
export async function mintShortManageToken(
  tx: BillingDbTransaction,
  input: {
    salonId: string;
    appointmentId: string;
    expiresAt: Date;
  },
): Promise<{ token: string; url: string }> {
  const token = randomBytes(SHORT_LINK_TOKEN_BYTES).toString('base64url');
  await tx.insert(appointmentAccessTokenSchema).values({
    id: crypto.randomUUID(),
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    tokenHash: hashOpaqueToken(token),
    expiresAt: input.expiresAt,
  });
  return { token, url: buildShortManageUrl(token) };
}

export type ShortLinkResolution =
  | { ok: true; salonSlug: string; appointmentId: string }
  | { ok: false };

/**
 * Resolve a short token to its capability. Returns the SAME opaque failure
 * for expired, revoked and never-existed tokens — this route is
 * unauthenticated and must not be an enumeration oracle.
 */
export async function resolveShortManageToken(
  tx: DbExecutor,
  token: string,
  now = new Date(),
): Promise<ShortLinkResolution> {
  if (token.length < 16 || token.length > 64 || !/^[\w-]+$/.test(token)) {
    return { ok: false };
  }
  const digest = hashOpaqueToken(token);
  const rows = await tx
    .select({
      appointmentId: appointmentAccessTokenSchema.appointmentId,
      expiresAt: appointmentAccessTokenSchema.expiresAt,
      salonSlug: salonSchema.slug,
    })
    .from(appointmentAccessTokenSchema)
    .innerJoin(salonSchema, eq(salonSchema.id, appointmentAccessTokenSchema.salonId))
    .where(and(
      eq(appointmentAccessTokenSchema.tokenHash, digest),
      isNull(appointmentAccessTokenSchema.revokedAt),
    ))
    .limit(1);
  const row = rows[0];
  if (row === undefined || row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false };
  }
  return { ok: true, salonSlug: row.salonSlug, appointmentId: row.appointmentId };
}
