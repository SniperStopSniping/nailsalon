/**
 * Monotonic execution time for deadlines and elapsed-duration measurements.
 *
 * Business time is deliberately supplied separately as a `Date` to the turn
 * loop and tools. Keeping this clock independent means deterministic fixtures
 * can freeze salon dates without freezing or expiring real request budgets.
 */
export type ExecutionNow = () => number;

export const monotonicNowMs: ExecutionNow = () => Math.floor(performance.now());
