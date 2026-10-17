/**
 * Standard API rates in micro-USD per token, verified 2026-10-17.
 * https://developers.openai.com/api/docs/models/gpt-6-luna
 * https://developers.openai.com/api/docs/models/gpt-6.1-sol
 * Setup requests explicitly pin service_tier=default in the provider adapter.
 */
export const SETUP_AI_MODEL = 'gpt-6-luna';
export const DESIGN_AI_MODEL = 'gpt-6.1-sol';
export const APPROVED_TRIAL_CAP_CAD = 80;
export const SETUP_MODEL_RATES = {
  'gpt-6-luna': { input: 0.1, cached: 0.01, cacheWrite: 0.125, output: 0.5 },
  'gpt-6.1-sol': { input: 2, cached: 0.1, cacheWrite: 2.5, output: 10 },
} as const;
export type SetupModel = keyof typeof SETUP_MODEL_RATES;
export function isSetupModel(model: string): model is SetupModel {
  return Object.hasOwn(SETUP_MODEL_RATES, model);
}

/** Only clearly bounded revisions use Luna. Unknown or broad design work uses Sol. */
export function selectDesignModel(message: string, hasPreviousSource: boolean): SetupModel {
  if (!hasPreviousSource || message.length > 700 || /\b(?:redesign|rebuild|start over|new design|entire|completely|layout|animation|interactive)\b/iu.test(message)) {
    return DESIGN_AI_MODEL;
  }
  return /\b(?:instagram|clickable|link|heading|font|colou?r|background|spacing|padding|margin|typo|button|larger|smaller|bigger)\b/iu.test(message)
    ? SETUP_AI_MODEL
    : DESIGN_AI_MODEL;
}
