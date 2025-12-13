// CANVAS FLOW OS — THE CONSTITUTION
// Every feature in this app MUST have an entry here.
// If it doesn't → it doesn't exist.

// -----------------------------
// CANVAS FLOW OS — STEP 2
// Module Metadata Contract
// -----------------------------

import type { CanvasSlot, CanvasState } from './constants';

// 1. MODULE ID (Canonical Feature Identity)
export type ModuleId =
  | 'next_client_protected'
  | 'focus_arc_protected'
  | 'auto_photo_protected'
  | 'step_checklist'
  | 'client_dna'
  | 'gap_filler'
  | 'smart_upsell'
  | 'money_ticker'
  | 'voice_orb';

// 2. MODULE TIER
export type ModuleTier =
  | 'core'
  | 'advanced'
  | 'experimental';

// 3. STRESS IMPACT
export type StressImpact =
  | 'none'
  | 'low'
  | 'medium'
  | 'high';

// 4. MODULE METADATA SHAPE
export type ModuleMeta = {
  id: ModuleId;
  allowedStates: CanvasState[];
  defaultSlot: CanvasSlot;
  priority: number;
  tier: ModuleTier;
  stress: StressImpact;
  conflictsWith?: ModuleId[];
  blockedInTemplates?: string[];
};

// 5. MODULE REGISTRY (Single Source of Truth)
export const MODULES: Record<ModuleId, ModuleMeta> = {
  // --- PROTECTED CORE MODULES ---

  next_client_protected: {
    id: 'next_client_protected',
    allowedStates: ['waiting'],
    defaultSlot: 'primary_card',
    priority: 1000,
    tier: 'core',
    stress: 'none',
  },

  focus_arc_protected: {
    id: 'focus_arc_protected',
    allowedStates: ['working'],
    defaultSlot: 'focus_anchor',
    priority: 1000,
    tier: 'core',
    stress: 'none',
  },

  auto_photo_protected: {
    id: 'auto_photo_protected',
    allowedStates: ['wrap_up'],
    defaultSlot: 'completion_row',
    priority: 1000,
    tier: 'core',
    stress: 'low',
  },

  // --- OPTIONAL MODULES ---

  step_checklist: {
    id: 'step_checklist',
    allowedStates: ['working'],
    defaultSlot: 'center_overlay',
    priority: 80,
    tier: 'core',
    stress: 'medium',
  },

  client_dna: {
    id: 'client_dna',
    allowedStates: ['waiting', 'working'],
    defaultSlot: 'top_overlay',
    priority: 60,
    tier: 'core',
    stress: 'low',
  },

  gap_filler: {
    id: 'gap_filler',
    allowedStates: ['waiting'],
    defaultSlot: 'bottom_actions',
    priority: 50,
    tier: 'core',
    stress: 'low',
  },

  smart_upsell: {
    id: 'smart_upsell',
    allowedStates: ['working', 'wrap_up'],
    defaultSlot: 'bottom_actions',
    priority: 40,
    tier: 'advanced',
    stress: 'medium',
    conflictsWith: ['step_checklist'],
    blockedInTemplates: ['zen_master'],
  },

  money_ticker: {
    id: 'money_ticker',
    allowedStates: ['wrap_up'],
    defaultSlot: 'top_overlay',
    priority: 30,
    tier: 'advanced',
    stress: 'high',
    blockedInTemplates: ['zen_master'],
  },

  voice_orb: {
    id: 'voice_orb',
    allowedStates: ['waiting', 'working', 'wrap_up'],
    defaultSlot: 'floating_assist',
    priority: 90,
    tier: 'experimental',
    stress: 'low',
  },
};
