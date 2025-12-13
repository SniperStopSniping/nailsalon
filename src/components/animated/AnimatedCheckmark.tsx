'use client';

import { motion } from 'framer-motion';

import { ANIMATION } from '@/libs/animations';

type AnimatedCheckmarkProps = {
  /** Size of the checkmark container */
  size?: number;
  /** Whether the checkmark is visible */
  isVisible: boolean;
  /** Background color (uses theme accent by default) */
  backgroundColor?: string;
  /** Checkmark stroke color */
  strokeColor?: string;
  /** Additional className for the container */
  className?: string;
};

/**
 * AnimatedCheckmark
 *
 * A spring-animated checkmark that pops in when selected.
 * Used for service cards, tech selection, etc.
 *
 * Usage:
 * ```tsx
 * <AnimatedCheckmark isVisible={isSelected} size={24} />
 * ```
 */
export function AnimatedCheckmark({
  size = 24,
  isVisible,
  backgroundColor = 'var(--n5-accent-hover)',
  strokeColor = 'var(--n5-ink-inverse)',
  className = '',
}: AnimatedCheckmarkProps) {
  return (
    <motion.div
      initial={false}
      animate={{
        scale: isVisible ? 1 : 0,
        opacity: isVisible ? 1 : 0,
      }}
      transition={{
        type: 'spring',
        ...ANIMATION.checkmarkSpring,
      }}
      className={`flex items-center justify-center ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: 'var(--n5-radius-pill)',
        backgroundColor,
      }}
    >
      <motion.svg
        width={size * 0.58}
        height={size * 0.58}
        viewBox="0 0 14 14"
        fill="none"
        initial={false}
        animate={{
          pathLength: isVisible ? 1 : 0,
        }}
        transition={{
          delay: isVisible ? 0.1 : 0,
          duration: 0.2,
        }}
      >
        <motion.path
          d="M3 7L6 10L11 4"
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: isVisible ? 1 : 0 }}
          transition={{
            delay: isVisible ? 0.1 : 0,
            duration: 0.2,
          }}
        />
      </motion.svg>
    </motion.div>
  );
}
