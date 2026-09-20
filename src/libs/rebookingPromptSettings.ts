export type RebookingPromptSettings = {
  enabled: boolean;
};

/**
 * Existing salons are deliberately opt-in. Onboarding writes the new-salon
 * default explicitly, so a missing or malformed value must never turn this on.
 */
export const DEFAULT_REBOOKING_PROMPT_SETTINGS: RebookingPromptSettings = {
  enabled: false,
};

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
  };
}
