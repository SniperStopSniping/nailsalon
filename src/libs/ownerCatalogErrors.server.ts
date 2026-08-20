import 'server-only';

/**
 * Luster L1 PR6 — shared owner-facing error shape for every catalog
 * configuration write path (add-on groups, add-ons, service families/
 * variants, confirmation mode, capabilities, technician assignment, and
 * rules).
 *
 * PURPOSE. Every one of those write paths runs inside a transaction and can
 * fail for a domain reason (not a raw DB error) that the owner needs to be
 * able to act on: WHAT is wrong, WHERE in the salon's configuration
 * (a stable semantic anchor — never a positional array index, an internal
 * row id treated as meaningful, or raw SQL), and — via `message` — HOW to
 * fix it. This is the one place that shape is defined, so every route
 * translates it identically instead of hand-rolling its own JSON error body.
 *
 * NOT the same anchor union as `CatalogViolationAnchor`
 * (`catalogDomain.ts`): that one describes a CLIENT SELECTION violation
 * against an already-valid catalog. This one describes a CONFIGURATION
 * WRITE being rejected before it is ever stored. Reusing the resolver's
 * anchor type here would blur two different failure domains that happen to
 * sound similar.
 */
export type OwnerCatalogErrorAnchor =
  | { kind: 'service'; serviceId: string }
  | { kind: 'variant'; serviceId: string }
  /** The FAMILY as a whole (the parent's id), for a cross-member invariant like "one axis per family". */
  | { kind: 'family'; serviceId: string }
  | { kind: 'addOn'; addOnId: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'capability'; capabilityId: string }
  | { kind: 'technician'; technicianId: string }
  | { kind: 'rule'; ruleId: string | null }
  | { kind: 'relationship' };

/**
 * Thrown by every owner-catalog write helper instead of a bare `Error` or a
 * raw DB constraint violation. `code` is a stable, bounded machine string a
 * route maps to an HTTP status; `message` is the owner-facing "how to fix
 * it" text; `anchor` is WHERE in the configuration the problem lives.
 */
export class OwnerCatalogConfigError extends Error {
  code: string;
  anchor: OwnerCatalogErrorAnchor;
  status: number;

  constructor(args: { code: string; message: string; anchor: OwnerCatalogErrorAnchor; status?: number }) {
    super(args.message);
    this.name = 'OwnerCatalogConfigError';
    this.code = args.code;
    this.anchor = args.anchor;
    this.status = args.status ?? 400;
  }
}

/** Uniform JSON body every route builds from a caught `OwnerCatalogConfigError`. */
export function ownerCatalogErrorResponse(error: OwnerCatalogConfigError): Response {
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        anchor: error.anchor,
      },
    },
    { status: error.status },
  );
}
