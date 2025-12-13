'use client';

import { motion } from 'framer-motion';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

import { ANIMATION } from '@/libs/animations';
import { type HapticType, triggerHaptic } from '@/libs/haptics';

type AnimatedButtonProps = {
  /** Button content */
  children: ReactNode;
  /** Click handler */
  onClick?: () => void;
  /** Haptic type to trigger on press */
  haptic?: HapticType;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Show pulse animation when button becomes enabled */
  pulseOnEnabled?: boolean;
  /** Additional className */
  className?: string;
  /** Inline styles */
  style?: React.CSSProperties;
  /** Button type */
  type?: 'button' | 'submit';
  /** Aria label for accessibility */
  ariaLabel?: string;
};

/**
 * AnimatedButton
 *
 * A button with:
 * - Scale animation on tap
 * - Optional haptic feedback
 * - Optional pulse animation when first enabled
 *
 * Usage:
 * ```tsx
 * <AnimatedButton
 *   onClick={handleContinue}
 *   haptic="confirm"
 *   pulseOnEnabled
 *   disabled={!isValid}
 * >
 *   Continue
 * </AnimatedButton>
 * ```
 */
export function AnimatedButton({
  children,
  onClick,
  haptic = 'confirm',
  disabled = false,
  pulseOnEnabled = false,
  className = '',
  style,
  type = 'button',
  ariaLabel,
}: AnimatedButtonProps) {
  const [shouldPulse, setShouldPulse] = useState(false);
  const [wasDisabled, setWasDisabled] = useState(disabled);

  // Track when button transitions from disabled to enabled
  useEffect(() => {
    if (pulseOnEnabled && wasDisabled && !disabled) {
      setShouldPulse(true);
      // Stop pulsing after one cycle
      const timer = setTimeout(() => {
        setShouldPulse(false);
      }, ANIMATION.duration.pulse);
      return () => clearTimeout(timer);
    }
    setWasDisabled(disabled);
    return undefined;
  }, [disabled, pulseOnEnabled, wasDisabled]);

  const handleClick = useCallback(() => {
    if (disabled) {
      return;
    }
    if (haptic) {
      triggerHaptic(haptic);
    }
    onClick?.();
  }, [disabled, haptic, onClick]);

  return (
    <motion.button
      type={type}
      onClick={handleClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`relative overflow-hidden ${className}`}
      style={style}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={{
        type: 'spring',
        ...ANIMATION.spring,
      }}
    >
      {/* Pulse overlay */}
      {shouldPulse && (
        <motion.div
          className="pointer-events-none absolute inset-0"
          initial={{ opacity: 0.6 }}
          animate={{
            opacity: [0.6, 0.3, 0.6],
            scale: [1, 1.02, 1],
          }}
          transition={{
            duration: 1,
            repeat: 1,
            ease: 'easeInOut',
          }}
          style={{
            background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.3), transparent)',
            borderRadius: 'inherit',
          }}
        />
      )}
      {children}
    </motion.button>
  );
}
