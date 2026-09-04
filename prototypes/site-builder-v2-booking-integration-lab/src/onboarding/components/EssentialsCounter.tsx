type EssentialsCounterProps = {
  remaining: number;
};

export function getEssentialsCounterMessage(remaining: number): string {
  if (remaining <= 0) {
    return 'All required steps complete';
  }
  return `${remaining} required ${remaining === 1 ? 'step' : 'steps'} left`;
}

export function EssentialsCounter({ remaining }: EssentialsCounterProps) {
  return (
    <p
      aria-atomic="true"
      aria-live="polite"
      className="onboarding-essentials-counter"
      role="status"
    >
      {getEssentialsCounterMessage(remaining)}
    </p>
  );
}
