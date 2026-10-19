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

/** Clear edits to an existing editable frontend need no business-intake model. */
export function requestsVisualEdit(message: string): boolean {
  // Numeric details can be prices, times or contact corrections even without
  // field names. Keep mixed requests on the structured intake path.
  if (/\d/u.test(message)
    || /\b(?:later|not yet|(?:don['’]t|do not|never)\s+(?:change|make|move|put|redesign|rebuild|add|use))\b/iu.test(message)
    || /\b(?:prices?|costs?|durations?|minutes?|hours|schedule|availability|polic(?:y|ies)|closed?|deposits?|cancellations?|reminders?|staff|team|currency|time ?zone|notice)\b|[$£€]\s*\d|\bopen\s+(?:on\s+)?(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekends?)\b/iu.test(message)) {
    return false;
  }
  return message.split(/[.!\n]/u).some((sentence) => {
    const instruction = sentence.trim().replace(/^(?:(?:please|can you|could you|would you)\s+)*/iu, '');
    return /^(?:completely\s+)?(?:redesign|rebuild)\b.{1,100}\b(?:hero|website|site|homepage|header|footer|gallery|section)\b/iu.test(instruction)
      || /^(?:make|move|put|place|enlarge|resize|overlap|centre|center|align)\b.{1,110}\b(?:hero|images?|photos?|logo|background|heading|text|gallery|mobile|spacing|section|services)\b.{1,100}\b(?:larger|smaller|bigger|overlap|middle|centre|center|left|right|above|below|before|after|less crowded|cream|black|beige|pink|white|premium|elegant|spacing|padding)\b/iu.test(instruction)
      || /^(?:use|change|make)\b.{1,70}\b(?:fonts?|typeface|typography|colou?rs?|background)\b/iu.test(instruction)
      || /^(?:add|use)\b.{1,70}\b(?:animated transitions|animations?|motion)\b/iu.test(instruction);
  });
}
