import type { ModuleId } from './modules';

export type TemplateId = 'zen_master' | 'growth_beast' | 'training_wheels';

export const TEMPLATES: Record<
  TemplateId,
  {
    label: string;
    description: string;
    defaultEnabled: ModuleId[];
    defaultBlocked?: ModuleId[];
  }
> = {
  zen_master: {
    label: 'Zen Master',
    description: 'Minimal distractions, maximum focus',
    defaultEnabled: ['voice_orb', 'client_dna'],
    defaultBlocked: ['money_ticker', 'smart_upsell', 'step_checklist'],
  },
  growth_beast: {
    label: 'Growth Beast',
    description: 'Maximize revenue and upsell opportunities',
    defaultEnabled: ['gap_filler', 'smart_upsell', 'money_ticker', 'voice_orb'],
  },
  training_wheels: {
    label: 'Training Wheels',
    description: 'Guided experience for new technicians',
    defaultEnabled: ['step_checklist', 'client_dna'],
    defaultBlocked: ['money_ticker'],
  },
};
