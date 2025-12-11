/**
 * Animation Constants
 *
 * Reusable animation tokens for consistent micro-interactions.
 * Matches the premium GlossGenius x Apple feel.
 *
 * Usage:
 * ```tsx
 * import { ANIMATION } from '@/libs/animations';
 *
 * // Scale animation
 * style={{
 *   transform: isPressed ? `scale(${ANIMATION.scale.tap})` : `scale(${ANIMATION.scale.settle})`,
 *   transition: `transform ${ANIMATION.duration.fast}ms ease-out`,
 * }}
 *
 * // Framer Motion spring
 * <motion.div
 *   animate={{ scale: 1 }}
 *   transition={{ type: 'spring', ...ANIMATION.spring }}
 * />
 * ```
 */

export const ANIMATION = {
  /**
   * Scale values for tap interactions
   */
  scale: {
    tap: 1.02, // Pressed state
    settle: 1.0, // Normal state
    tapSmall: 1.01, // Subtle press for secondary elements
  },

  /**
   * Duration in milliseconds
   */
  duration: {
    fast: 120, // Quick micro-interactions
    normal: 200, // Standard transitions
    slow: 300, // Page transitions, modals
    pulse: 2000, // Slow pulse animation cycle
  },

  /**
   * Spring physics for Framer Motion
   */
  spring: {
    damping: 25,
    stiffness: 200,
  },

  /**
   * Checkmark spring (bouncier)
   */
  checkmarkSpring: {
    damping: 15,
    stiffness: 300,
  },

  /**
   * Vertical slide distance in pixels
   */
  slideY: 8,

  /**
   * Glow/border fade duration
   */
  glowFade: 150,

  /**
   * Shake animation for errors
   */
  shake: {
    duration: 400,
    intensity: 4, // pixels
  },

  /**
   * Easing functions
   */
  easing: {
    easeOut: 'cubic-bezier(0.0, 0.0, 0.2, 1)',
    easeInOut: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
    spring: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  },
} as const;

/**
 * CSS keyframes for shake animation.
 * Include this in your global styles or component.
 */
export const shakeKeyframes = `
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-${ANIMATION.shake.intensity}px); }
  20%, 40%, 60%, 80% { transform: translateX(${ANIMATION.shake.intensity}px); }
}
`;

/**
 * CSS keyframes for pulse animation.
 */
export const pulseKeyframes = `
@keyframes pulse-glow {
  0%, 100% { 
    box-shadow: 0 0 0 0 var(--n5-accent);
    opacity: 1;
  }
  50% { 
    box-shadow: 0 0 0 4px transparent;
    opacity: 0.8;
  }
}
`;
