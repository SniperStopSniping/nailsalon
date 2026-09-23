export type RebookingPromptSettings = {
  enabled: boolean;
  intervalWeeks: number;
  message: string;
};

/**
 * Existing salons are deliberately opt-in. Onboarding writes the new-salon
 * default explicitly, so a missing or malformed value must never turn this on.
 */
export const DEFAULT_REBOOKING_PROMPT_SETTINGS: RebookingPromptSettings = {
  enabled: false,
  intervalWeeks: 3,
  message: 'Secure your next spot now.',
};

export const REBOOKING_PROMPT_LIMITS = {
  intervalWeeks: { min: 1, max: 52 },
  messageMaxLength: 300,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveRebookingPromptSettings(
  rawSalonSettings: unknown,
): RebookingPromptSettings {
  if (
    !isRecord(rawSalonSettings)
    || !isRecord(rawSalonSettings.rebookingPrompt)
  ) {
    return DEFAULT_REBOOKING_PROMPT_SETTINGS;
  }

  return {
    enabled: rawSalonSettings.rebookingPrompt.enabled === true,
    intervalWeeks: validIntervalWeeks(rawSalonSettings.rebookingPrompt.intervalWeeks),
    message: validMessage(rawSalonSettings.rebookingPrompt.message),
  };
}

function validIntervalWeeks(value: unknown): number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= REBOOKING_PROMPT_LIMITS.intervalWeeks.min
    && value <= REBOOKING_PROMPT_LIMITS.intervalWeeks.max
    ? value
    : DEFAULT_REBOOKING_PROMPT_SETTINGS.intervalWeeks;
}

function validMessage(value: unknown): string {
  return typeof value === 'string'
    && value.length <= REBOOKING_PROMPT_LIMITS.messageMaxLength
    ? value
    : DEFAULT_REBOOKING_PROMPT_SETTINGS.message;
}
