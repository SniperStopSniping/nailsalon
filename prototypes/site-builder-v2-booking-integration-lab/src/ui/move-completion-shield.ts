export const MOVE_COMPLETION_SEQUENCE_HARD_CAP_MS = 250;
export const MOVE_COMPLETION_SHIELD_DURATION_MS = 550;
export const MOVE_COMPLETION_SHIELD_TOLERANCE_PX = 12;

export type MoveCompletionBounds = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export type MoveCompletionPointerType = 'keyboard' | 'mouse' | 'pen' | 'touch';

export type MoveCompletionSource =
  | 'cancel'
  | 'discard-changes'
  | 'done'
  | 'keep-order';

export type MoveCompletionShield = {
  bounds: MoveCompletionBounds;
  button: number;
  completionSource: MoveCompletionSource;
  eventTimestamp: number;
  expiresAt: number;
  focusTargetSectionId: string;
  pointerType: MoveCompletionPointerType;
  startedAt: number;
};

export type MoveCompletionPointerInteraction = {
  button: number;
  clientX: number;
  clientY: number;
  now: number;
  pointerType: Exclude<MoveCompletionPointerType, 'keyboard'>;
  sequenceUntil?: number | null;
};

export type MoveCompletionShieldDecision = 'absorb' | 'release';

type RectLike = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export function createMoveCompletionBounds(
  rectangle: RectLike,
): MoveCompletionBounds {
  return {
    bottom: rectangle.bottom + MOVE_COMPLETION_SHIELD_TOLERANCE_PX,
    left: rectangle.left - MOVE_COMPLETION_SHIELD_TOLERANCE_PX,
    right: rectangle.right + MOVE_COMPLETION_SHIELD_TOLERANCE_PX,
    top: rectangle.top - MOVE_COMPLETION_SHIELD_TOLERANCE_PX,
  };
}

export function createMoveCompletionShield({
  bounds,
  button,
  completionSource,
  eventTimestamp,
  focusTargetSectionId,
  pointerType,
  startedAt,
}: Omit<MoveCompletionShield, 'expiresAt'>): MoveCompletionShield {
  return {
    bounds,
    button,
    completionSource,
    eventTimestamp,
    expiresAt: startedAt + MOVE_COMPLETION_SHIELD_DURATION_MS,
    focusTargetSectionId,
    pointerType,
    startedAt,
  };
}

export function moveCompletionShieldIsActive(
  shield: MoveCompletionShield | null,
  now: number,
  sequenceUntil: number | null = null,
): shield is MoveCompletionShield {
  return shield !== null && (
    now < shield.expiresAt
    || (sequenceUntil !== null && now < sequenceUntil)
  );
}

export function decideMoveCompletionPointerInteraction(
  shield: MoveCompletionShield,
  interaction: MoveCompletionPointerInteraction,
): MoveCompletionShieldDecision {
  if (!moveCompletionShieldIsActive(
    shield,
    interaction.now,
    interaction.sequenceUntil,
  )) {
    return 'release';
  }

  const insideProtectedBounds = interaction.clientX >= shield.bounds.left
    && interaction.clientX <= shield.bounds.right
    && interaction.clientY >= shield.bounds.top
    && interaction.clientY <= shield.bounds.bottom;
  if (!insideProtectedBounds) {
    return 'release';
  }

  const pointerTypeMatches = interaction.pointerType === shield.pointerType
    || (shield.pointerType === 'keyboard' && interaction.pointerType === 'mouse')
    || (shield.pointerType === 'touch' && interaction.pointerType === 'mouse');
  if (!pointerTypeMatches || interaction.button !== shield.button) {
    return 'release';
  }

  return 'absorb';
}
