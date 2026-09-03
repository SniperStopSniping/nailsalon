import {
  createMoveCompletionBounds,
  createMoveCompletionShield,
  decideMoveCompletionPointerInteraction,
  MOVE_COMPLETION_SEQUENCE_HARD_CAP_MS,
  MOVE_COMPLETION_SHIELD_DURATION_MS,
  moveCompletionShieldIsActive,
} from './move-completion-shield';

const bounds = createMoveCompletionBounds({
  bottom: 140,
  left: 100,
  right: 200,
  top: 100,
});

const createShield = (pointerType: 'keyboard' | 'mouse' | 'touch' = 'mouse') => (
  createMoveCompletionShield({
    bounds,
    button: 0,
    completionSource: 'done',
    eventTimestamp: 42,
    focusTargetSectionId: 'section-01',
    pointerType,
    startedAt: 1_000,
  })
);

describe('Move completion trailing-pointer shield', () => {
  it('pads the former action-button geometry by the fixed tolerance', () => {
    expect(bounds).toEqual({
      bottom: 152,
      left: 88,
      right: 212,
      top: 88,
    });
  });

  it('absorbs matching primary mouse input anywhere inside the protected geometry', () => {
    const shield = createShield();
    for (const [clientX, clientY] of [
      [88, 88],
      [150, 120],
      [212, 152],
    ] as const) {
      expect(decideMoveCompletionPointerInteraction(shield, {
        button: 0,
        clientX,
        clientY,
        now: 1_200,
        pointerType: 'mouse',
      })).toBe('absorb');
    }
  });

  it('releases immediately for outside geometry or a different pointer/button class', () => {
    const shield = createShield();

    expect(decideMoveCompletionPointerInteraction(shield, {
      button: 0,
      clientX: 87,
      clientY: 120,
      now: 1_200,
      pointerType: 'mouse',
    })).toBe('release');
    expect(decideMoveCompletionPointerInteraction(shield, {
      button: 2,
      clientX: 150,
      clientY: 120,
      now: 1_200,
      pointerType: 'mouse',
    })).toBe('release');
    expect(decideMoveCompletionPointerInteraction(shield, {
      button: 0,
      clientX: 150,
      clientY: 120,
      now: 1_200,
      pointerType: 'touch',
    })).toBe('release');
  });

  it('accepts mouse compatibility events after keyboard or touch completion', () => {
    for (const pointerType of ['keyboard', 'touch'] as const) {
      expect(decideMoveCompletionPointerInteraction(createShield(pointerType), {
        button: 0,
        clientX: 150,
        clientY: 120,
        now: 1_200,
        pointerType: 'mouse',
      })).toBe('absorb');
    }
  });

  it('uses an absolute 550 ms base deadline and releases at the boundary', () => {
    const shield = createShield();

    expect(MOVE_COMPLETION_SHIELD_DURATION_MS).toBe(550);
    expect(shield).toMatchObject({
      button: 0,
      completionSource: 'done',
      eventTimestamp: 42,
      focusTargetSectionId: 'section-01',
      pointerType: 'mouse',
      startedAt: 1_000,
    });
    expect(shield.expiresAt - shield.startedAt).toBe(550);
    expect(moveCompletionShieldIsActive(shield, 1_549)).toBe(true);
    expect(moveCompletionShieldIsActive(shield, 1_550)).toBe(false);
    expect(decideMoveCompletionPointerInteraction(shield, {
      button: 0,
      clientX: 150,
      clientY: 120,
      now: 1_550,
      pointerType: 'mouse',
    })).toBe('release');
  });

  it('latches a started matching sequence through its short hard cap only', () => {
    const shield = createShield();
    const sequenceUntil = 1_800;

    expect(MOVE_COMPLETION_SEQUENCE_HARD_CAP_MS).toBe(250);
    expect(moveCompletionShieldIsActive(shield, 1_600, sequenceUntil)).toBe(true);
    expect(decideMoveCompletionPointerInteraction(shield, {
      button: 0,
      clientX: 150,
      clientY: 120,
      now: 1_600,
      pointerType: 'mouse',
      sequenceUntil,
    })).toBe('absorb');
    expect(decideMoveCompletionPointerInteraction(shield, {
      button: 0,
      clientX: 87,
      clientY: 120,
      now: 1_600,
      pointerType: 'mouse',
      sequenceUntil,
    })).toBe('release');
    expect(moveCompletionShieldIsActive(shield, sequenceUntil, sequenceUntil)).toBe(false);
  });
});
