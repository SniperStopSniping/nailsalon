/**
 * The one ledger fact an operator script may need without loading the app.
 *
 * `ledger.server.ts` owns `OWNER_ASSISTANT_AUDIT_ACTION`, but importing it
 * pulls `@/libs/DB`, which opens (or builds and migrates) a database at module
 * evaluation time. A read-only reporting script must not do that: it manages
 * its own `pg.Client` against a target it has attested itself.
 *
 * So the action name is re-declared here, in a module with no imports at all,
 * and `evals.test.ts` asserts it equals the production constant. The
 * duplication is deliberate and pinned, not accidental.
 */
export const OWNER_ASSISTANT_AUDIT_ACTION_NAME = 'owner_assistant_turn';
