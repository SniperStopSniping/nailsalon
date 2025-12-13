'use client';

// =============================================================================
// Progress Ring Component
// Visual state progression indicator (glanceable)
// =============================================================================

type ProgressRingProps = {
  /** Canvas state */
  state: string;
  /** Size in pixels */
  size?: number;
};

// State to progress percentage mapping
const STATE_PROGRESS: Record<string, number> = {
  waiting: 0,
  working: 50,
  wrap_up: 80,
  complete: 100,
  cancelled: 0,
  no_show: 0,
};

// State to color mapping
const STATE_COLORS: Record<string, string> = {
  waiting: '#D97706', // Amber
  working: '#2563EB', // Blue
  wrap_up: '#7C3AED', // Purple
  complete: '#059669', // Green
  cancelled: '#DC2626', // Red
  no_show: '#DC2626', // Red
};

export function ProgressRing({ state, size = 32 }: ProgressRingProps) {
  const progress = STATE_PROGRESS[state] ?? 0;
  const color = STATE_COLORS[state] ?? '#9CA3AF';

  // SVG calculations
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  // Terminal states show different visual
  const isTerminal = ['complete', 'cancelled', 'no_show'].includes(state);

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        className="-rotate-90"
      >
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#E5E7EB"
          strokeWidth={strokeWidth}
        />

        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{
            transition: 'stroke-dashoffset 0.5s ease-out, stroke 0.3s ease',
          }}
        />
      </svg>

      {/* Center indicator */}
      <div
        className="absolute flex items-center justify-center"
        style={{ width: size - 12, height: size - 12 }}
      >
        {isTerminal
          ? (
              <span
                className="text-xs font-bold"
                style={{ color }}
              >
                {state === 'complete' ? '✓' : '✕'}
              </span>
            )
          : (
              <div
                className="size-2 rounded-full"
                style={{
                  backgroundColor: color,
                  animation: state === 'working' ? 'pulse 2s infinite' : 'none',
                }}
              />
            )}
      </div>

      {/* Pulse animation for working state */}
      <style jsx>
        {`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.5;
            transform: scale(0.8);
          }
        }
      `}
      </style>
    </div>
  );
}

export default ProgressRing;
