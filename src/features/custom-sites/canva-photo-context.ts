/** Context optimization only: this never authorizes or applies an action. */
export function usesSavedCanvaPhotoContext(message: string) {
  const reading = /\b(?:read|reread|re-read|extract|scan|ocr|import|transcribe)\b|\b(?:get|take|pull|copy|use|check|verify|find|add|set|update|change)\b.{1,100}\b(?:details?|information|info|names?|hours?|prices?|polic(?:y|ies)|addresses?|contacts?|phone|email|instagram|text|wording|location|intersection)\b|\b(?:details?|information|info|names?|hours?|prices?|polic(?:y|ies)|addresses?|contacts?|phone|email|instagram|text|wording|location|intersection)\b.{1,50}\b(?:from|in|on)\b.{1,35}\b(?:image|picture|design|menu|screenshot|upload|reference)\b|\b(?:what|which|where|does|is|are)\b.{1,100}\b(?:in|on|from)\b.{1,35}\b(?:image|picture|design|menu|screenshot|upload|reference)\b/iu;
  return message.length <= 4000
    && /\b(?:gallery|portraits?|photos?|pictures?|images?)\b/iu.test(message)
    && /\b(?:add|use|remove|replace|swap|move|put|order|reorder|arrange|make|show|switch|change|describe|rename|caption|larger|bigger|smaller|first|last|earlier|later)\b/iu.test(message)
    && !reading.test(message);
}
