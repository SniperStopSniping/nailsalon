import type { EvalSpendCeilingHalt, EvalSpendGuard } from './harness';
import { formatMicros } from './report';
import { shouldStopForSpend } from './runnerGuards';

/** Existing turn-boundary accounting, also stopping when usage is unknown. */
export function createEvalSpendGuard(ceilingMicros: number, reserveMicros: number): EvalSpendGuard {
  let spentMicros = 0;
  let maxObservedTurnCostMicros = 0;
  let halt: EvalSpendCeilingHalt | undefined;
  return {
    checkBeforeTurn: () => {
      const estimatedNextMicros = Math.max(maxObservedTurnCostMicros, reserveMicros);
      if (!halt && shouldStopForSpend({ spentMicros, ceilingMicros, estimatedNextMicros })) {
        halt = {
          reason: `spent ${formatMicros(spentMicros)}; the next turn reserve ${formatMicros(estimatedNextMicros)} would meet or exceed the ceiling`,
          spentMicros,
          ceilingMicros,
        };
      }
      return halt;
    },
    recordTurnCost: (costMicros) => {
      if (costMicros === null) {
        spentMicros += Math.max(maxObservedTurnCostMicros, reserveMicros);
        halt = {
          reason: 'provider usage is unknown; further evaluation stopped and a conservative turn reserve retained',
          spentMicros,
          ceilingMicros,
        };
      } else {
        spentMicros += costMicros;
        maxObservedTurnCostMicros = Math.max(maxObservedTurnCostMicros, costMicros);
        if (!halt && shouldStopForSpend({ spentMicros, ceilingMicros, estimatedNextMicros: 0 })) {
          halt = { reason: 'accounted spend reached the ceiling', spentMicros, ceilingMicros };
        }
      }
      return halt;
    },
  };
}
