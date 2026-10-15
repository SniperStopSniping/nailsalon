'use client';

import { useState } from 'react';

type Evidence = { ordinal: number; provider: string; model: string; elapsedMs: number | null; inputTokens: number | null; outputTokens: number | null; costMicroUsd: number | null; validation: string; rawOutput: string | null };

export function GenerationEvidence({ endpoint, operationId }: { endpoint: string; operationId: string }) {
  const [items, setItems] = useState<Evidence[]>([]);
  const [error, setError] = useState('');
  async function load() {
    try {
      const response = await fetch(`${endpoint}&generation=${operationId}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Generation details could not be loaded.');
      }
      setItems((await response.json()).evidence);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    }
  }
  return (
    <details onToggle={(event) => {
      if (event.currentTarget.open) {
        void load();
      }
    }}
    >
      <summary>Generation details and original output</summary>
      {error && <p role="alert">{error}</p>}
      {items.map(item => (
        <div key={item.ordinal}>
          <p>
            {item.ordinal ? 'Automatic repair' : 'First result'}
            {' · '}
            {item.provider}
            {' / '}
            {item.model}
            {' · '}
            {item.elapsedMs === null ? 'Time unavailable' : `${(item.elapsedMs / 1000).toFixed(1)} seconds`}
            {' · '}
            {item.costMicroUsd === null ? 'Usage unknown; budget reservation retained' : `Estimated provider cost: USD $${(item.costMicroUsd / 1000000).toFixed(4)}`}
          </p>
          <p>{`Tokens: ${item.inputTokens ?? '?'} input / ${item.outputTokens ?? '?'} output. Validation: ${item.validation}`}</p>
          <details>
            <summary>Read original model response (text only)</summary>
            <pre style={{ maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.rawOutput ?? 'No output was received.'}</pre>
          </details>
        </div>
      ))}
      {!items.length && !error && <p>No provider response recorded yet.</p>}
    </details>
  );
}
