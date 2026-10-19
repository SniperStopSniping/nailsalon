/** Context optimization only: this never authorizes or applies an action. */
export function usesSavedCanvaPhotoContext(message: string) {
  // Owner-supplied About copy and known library photos need no fresh OCR.
  // Explicit extraction, reference questions and newly uploaded files retain
  // vision eligibility; this optimization never supplies an action permission.
  if (message.length <= 4000
    && /\babout\s+(?:section|text|wording|heading)\b/iu.test(message)
    && /\b(?:add|create|write|edit|change|update|say|replace)\b/iu.test(message)
    && !/\b(?:read|reread|re-read|extract|scan|ocr|import|transcribe)\b|\b(?:from|in|on)\b.{1,70}\b(?:image|picture|design|menu|screenshot|upload|reference)\b|\b(?:what|which|where|does|is|are)\b.{1,70}\b(?:image|picture|design|menu|screenshot|upload|reference)\b/iu.test(message)) {
    return true;
  }
  const reading = /\b(?:read|reread|re-read|extract|scan|ocr|import|transcribe)\b|\b(?:get|take|pull|copy|use|check|verify|find|add|set|update|change)\b.{1,100}\b(?:details?|information|info|names?|hours?|prices?|polic(?:y|ies)|addresses?|contacts?|phone|email|instagram|text|wording|location|intersection)\b|\b(?:details?|information|info|names?|hours?|prices?|polic(?:y|ies)|addresses?|contacts?|phone|email|instagram|text|wording|location|intersection)\b.{1,50}\b(?:from|in|on)\b.{1,35}\b(?:image|picture|design|menu|screenshot|upload|reference)\b|\b(?:what|which|where|does|is|are)\b.{1,100}\b(?:in|on|from)\b.{1,35}\b(?:image|picture|design|menu|screenshot|upload|reference)\b/iu;
  return message.length <= 4000
    && /\b(?:gallery|portraits?|photos?|pictures?|images?)\b/iu.test(message)
    && /\b(?:add|use|remove|replace|swap|move|put|order|reorder|arrange|make|show|switch|change|describe|rename|caption|larger|bigger|smaller|first|last|earlier|later)\b/iu.test(message)
    && !reading.test(message);
}

/** Repair a false capability denial, never authorize an otherwise unsupported edit. */
export function rejectsSupportedAboutText(message: string, reply: string, aboutCount: number) {
  return aboutCount === 1
    && /\babout\s+(?:heading|text|wording)\b/iu.test(message)
    && /\b(?:change|set|rename|update|replace|rewrite)\b/iu.test(message)
    && !/\b(?:font|typography|colou?r|size|spacing|animat\w*|layout|style|background|printed)\b/iu.test(message)
    && /\b(?:cannot|can['’]t|unable)\b/iu.test(reply)
    && /\b(?:canva\s+export|fixed[- ]artwork|editable\s+redesign|printed\s+text)\b/iu.test(reply);
}
