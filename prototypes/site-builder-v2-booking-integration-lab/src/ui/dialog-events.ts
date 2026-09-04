const locallyHandledEscapeEvents = new WeakSet<Event>();

export const DIALOG_ACTIVITY_EVENT = 'luster:dialog-activity';

export function announceDialogActivity(openDialogCount: number): void {
  const active = openDialogCount > 0;
  document.documentElement.classList.toggle('luster-dialog-open', active);
  window.dispatchEvent(new CustomEvent(DIALOG_ACTIVITY_EVENT, {
    detail: { active, openDialogCount },
  }));
}

export function keepEscapeInsideActiveControl(event: Event): void {
  locallyHandledEscapeEvents.add(event);
}

export function isEscapeHandledInsideActiveControl(event: Event): boolean {
  return locallyHandledEscapeEvents.has(event);
}
