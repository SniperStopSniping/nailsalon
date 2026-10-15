/** Narrow fallback for an explicit first-site request, never a publish command. */
export function requestsFirstWebsite(message: string): boolean {
  if (/\b(?:later|not yet|after I|after we|(?:don't|do not|never)\s+(?:create|build|make|generate|recreate|design))\b/iu.test(message)) {
    return false;
  }
  return message.split(/[.!?\n]/u).some(sentence => /^(?:(?:please|can you|could you|would you)\s+)*(?:create|build|make|generate|recreate|design)\b.{1,80}\b(?:website|site|booking page|homepage)\b/iu.test(sentence.trim()));
}
