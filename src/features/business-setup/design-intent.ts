/** Narrow fallback for an explicit first-site request, never a publish command. */
export function requestsFirstWebsite(message: string): boolean {
  if (/\b(?:later|not yet|after I|after we|(?:don't|do not|never)\s+(?:create|build|make|generate|recreate|design))\b/iu.test(message)) {
    return false;
  }
  return message.split(/[.!?\n]/u).some(sentence => /^(?:(?:please|can you|could you|would you)\s+)*(?:create|build|make|generate|recreate|design)\b.{1,80}\b(?:website|site|booking page|homepage)\b/iu.test(sentence.trim()));
}

/** A first visual draft may use suggestions without approving business data. */
export function requestsPreviewNow(message: string, hasReference = false): boolean {
  if (/\b(?:later|not yet|(?:don't|do not|never)\s+(?:create|build|make|generate|recreate|design|use|show))\b/iu.test(message)) {
    return false;
  }
  return requestsFirstWebsite(message)
    || /\b(?:just\s+)?make\s+(?:it|something|stuff|things)\s+up\b|\b(?:use|add|pick|choose)\s+(?:some\s+)?(?:sample|example|suggested|random|placeholder)\b/iu.test(message)
    || (hasReference && /\b(?:make|create|build|recreate|copy|match|generate)\b.{1,65}\b(?:this|image|design|reference)\b/iu.test(message))
    || (hasReference && message.split(/[.!?\n]/u).some(sentence => /^(?:(?:please|can you|could you|would you)\s+)*(?:keep|preserve)\b.{1,65}\b(?:design|artwork|image)\b/iu.test(sentence.trim())) && /\b(?:clickable|interactive|booking|links)\b/iu.test(message));
}

export function requestsSampleDetails(message: string): boolean {
  // Skip intake only for a standalone request to use suggestions. A mixed
  // message may also supply a real name, location, hours or services; those
  // answers must go through structured intake before design generation.
  return requestsPreviewNow(message) && /^(?:please\s+)?(?:just\s+)?(?:make\s+(?:it|something|stuff|things)\s+up|(?:use|add|pick|choose)\s+(?:some\s+)?(?:sample|example|suggested|random|placeholder)\s+(?:details|information|prices|hours|services|booking details))(?:\s+(?:for\s+(?:the\s+)?(?:preview|now)|now|please))?[.!\s]*$/iu.test(message.trim());
}
