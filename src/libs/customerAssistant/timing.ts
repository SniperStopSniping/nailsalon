export type CustomerTimingStage = 'setup' | 'catalogue' | 'model' | 'resolution' | 'availability' | 'reply' | 'persistence' | 'total';

/** Durations only: no IDs, prompts, tokens, client identity or business facts. */
export class CustomerTurnTiming {
  private readonly durations: Partial<Record<CustomerTimingStage, number>> = {};

  async measure<T>(stage: CustomerTimingStage, work: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await work();
    } finally {
      this.add(stage, performance.now() - start);
    }
  }

  add(stage: CustomerTimingStage, milliseconds: number) {
    this.durations[stage] = (this.durations[stage] ?? 0) + milliseconds;
  }

  snapshot() {
    return Object.fromEntries(Object.entries(this.durations).map(([stage, value]) => [stage, Math.round(stage === 'resolution' ? Math.max(0, value - (this.durations.availability ?? 0)) : value)]));
  }

  header() {
    return Object.entries(this.snapshot()).map(([stage, value]) => `${stage};dur=${value}`).join(', ');
  }
}
