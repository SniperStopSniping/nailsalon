// -----------------------------
// CANVAS FLOW OS — STEP 1
// Canonical Constants (Immutable)
// -----------------------------

// 1. STATES (Lifecycle)
export const STATES = [
  'waiting',
  'working',
  'wrap_up',
] as const;

export type CanvasState = typeof STATES[number];

// 2. ALL POSSIBLE SLOTS
export const SLOTS = [
  'primary_card', // Waiting state hero (Next Client Orb)
  'top_overlay',
  'center_overlay',
  'bottom_actions',
  'floating_assist',
  'focus_anchor',
  'completion_row',
] as const;

export type CanvasSlot = typeof SLOTS[number];

// 3. PROTECTED SLOTS (Hard Rules — cannot be removed)
export const PROTECTED_SLOTS: Record<CanvasState, CanvasSlot> = {
  waiting: 'primary_card', // Next client / arrival orb
  working: 'focus_anchor', // Focus arc (timer)
  wrap_up: 'completion_row', // Photo + finish
};

// 4. ALLOWED SLOTS PER STATE
export const STATE_SLOTS: Record<CanvasState, CanvasSlot[]> = {
  waiting: [
    'top_overlay',
    'primary_card',
    'bottom_actions',
    'floating_assist',
  ],

  working: [
    'top_overlay',
    'center_overlay',
    'focus_anchor',
    'floating_assist',
  ],

  wrap_up: [
    'top_overlay',
    'completion_row',
    'bottom_actions',
    'floating_assist',
  ],
};

// 5. FALLBACK LAYOUT (Disaster-Safe Defaults)
export const FALLBACK_LAYOUT: Record<
  CanvasState,
  Partial<Record<CanvasSlot, string[]>>
> = {
  waiting: {
    primary_card: ['next_client_protected'],
  },
  working: {
    focus_anchor: ['focus_arc_protected'],
  },
  wrap_up: {
    completion_row: ['auto_photo_protected'],
  },
};
