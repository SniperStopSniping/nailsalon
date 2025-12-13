import React from 'react';

import type { ModuleId } from './modules';

const Placeholder: React.FC<{ name: string }> = ({ name }) => (
  <div style={{ padding: 8 }}>
    <span>{name}</span>
  </div>
);

export const MODULE_REGISTRY: Record<ModuleId, React.FC<any>> = {
  next_client_protected: () => <Placeholder name="next_client_protected" />,
  focus_arc_protected: () => <Placeholder name="focus_arc_protected" />,
  auto_photo_protected: () => <Placeholder name="auto_photo_protected" />,
  step_checklist: () => <Placeholder name="step_checklist" />,
  client_dna: () => <Placeholder name="client_dna" />,
  gap_filler: () => <Placeholder name="gap_filler" />,
  smart_upsell: () => <Placeholder name="smart_upsell" />,
  money_ticker: () => <Placeholder name="money_ticker" />,
  voice_orb: () => <Placeholder name="voice_orb" />,
};
