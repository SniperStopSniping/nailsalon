type EssentialsCounterProps = {
  remaining: number;
};

export function getEssentialsCounterMessage(remaining: number): string {
  if (remaining <= 0) return 'All essentials complete';
  return `${remaining} essential${remaining === 1 ? '' : 's'} left`;
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
