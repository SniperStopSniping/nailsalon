import React from 'react';

import type { CanvasSlot, CanvasState } from './constants';
import { MODULE_REGISTRY } from './ModuleRegistry';
import type { ModuleId } from './modules';
import { resolveLayout } from './resolveLayout';

const SLOT_ORDER: Record<CanvasState, CanvasSlot[]> = {
  waiting: ['top_overlay', 'primary_card', 'bottom_actions', 'floating_assist'],
  working: ['top_overlay', 'focus_anchor', 'center_overlay', 'bottom_actions', 'floating_assist'],
  wrap_up: ['top_overlay', 'completion_row', 'bottom_actions', 'floating_assist'],
};

export function CanvasRenderer(props: {
  state: CanvasState;
  enabledModules: ModuleId[];
  blockedModules?: ModuleId[];
  templateId?: string;
}) {
  const { state, enabledModules, blockedModules, templateId } = props;

  const layout = resolveLayout({
    state,
    enabledModules,
    blockedModules,
    templateId,
  });

  const slots = SLOT_ORDER[state];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {slots.map((slot) => {
        const modules = layout[slot];
        if (!modules || modules.length === 0) {
          return null;
        }

        return (
          <section key={slot}>
            {modules.map((moduleId) => {
              const Component = MODULE_REGISTRY[moduleId];
              if (!Component) {
                return null;
              }
              return <Component key={moduleId} />;
            })}
          </section>
        );
      })}
    </div>
  );
}
