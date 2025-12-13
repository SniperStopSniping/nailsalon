'use client';

import { motion } from 'framer-motion';
import { type ReactNode, useCallback } from 'react';

import { ANIMATION } from '@/libs/animations';
import { type HapticType, triggerHaptic } from '@/libs/haptics';

type AnimatedCardProps = {
  /** Card content */
  children: ReactNode;
  /** Click handler */
  onPress?: () => void;
  /** Haptic type to trigger on press (optional) */
  haptic?: HapticType;
  /** Whether the card is selected */
  selected?: boolean;
  /** Whether the card is disabled */
  disabled?: boolean;
  /** Additional className */
  className?: string;
  /** Inline styles */
  style?: React.CSSProperties;
  /** Border radius override */
  borderRadius?: string;
  /** Show gold glow when selected */
  showGlow?: boolean;
  /** Aria label for accessibility */
  ariaLabel?: string;
};

/**
 * AnimatedCard
 *
 * A reusable tappable card with:
 * - Scale animation on tap (1.02 -> 1.0)
 * - Optional haptic feedback
 * - Optional gold glow when selected
 *
 * Usage:
 * ```tsx
 * <AnimatedCard
 *   selected={isSelected}
 *   haptic={isSelected ? 'deselect' : 'select'}
 *   onPress={() => toggleSelection(id)}
 *   showGlow
 * >
 *   <ServiceContent />
 * </AnimatedCard>
 * ```
 */
export function AnimatedCard({
  children,
  onPress,
  haptic,
  selected = false,
  disabled = false,
  className = '',
  style,
  borderRadius = 'var(--n5-radius-md)',
  showGlow = false,
  ariaLabel,
}: AnimatedCardProps) {
  const handlePress = useCallback(() => {
    if (disabled) {
      return;
    }
    if (haptic) {
      triggerHaptic(haptic);
    }
    onPress?.();
  }, [disabled, haptic, onPress]);

  return (
    <motion.button
      type="button"
      onClick={handlePress}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={selected}
      className={`relative overflow-hidden text-left transition-shadow ${className}`}
      style={{
        borderRadius,
        ...style,
        // Gold glow effect when selected
        boxShadow: selected && showGlow
          ? `0 0 0 2px var(--n5-accent), 0 4px 20px rgba(0,0,0,0.08)`
          : '0 4px 20px rgba(0,0,0,0.08)',
      }}
      whileTap={disabled ? undefined : { scale: ANIMATION.scale.tap }}
      transition={{
        type: 'spring',
        ...ANIMATION.spring,
      }}
    >
      {/* Glow overlay for selected state */}
      {showGlow && (
        <motion.div
          className="pointer-events-none absolute inset-0"
          initial={false}
          animate={{
            opacity: selected ? 1 : 0,
          }}
          transition={{
            duration: ANIMATION.glowFade / 1000,
          }}
          style={{
            background: `linear-gradient(to bottom right, color-mix(in srgb, var(--n5-accent) 10%, transparent), transparent)`,
            borderRadius,
          }}
        />
      )}
      {children}
    </motion.button>
  );
}
