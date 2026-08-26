const locallyHandledEscapeEvents = new WeakSet<Event>();

export function keepEscapeInsideActiveControl(event: Event): void {
  locallyHandledEscapeEvents.add(event);
}

export function isEscapeHandledInsideActiveControl(event: Event): boolean {
  return locallyHandledEscapeEvents.has(event);
}
