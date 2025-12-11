'use client';

import { motion } from 'framer-motion';
import { type ReactNode } from 'react';

import { ANIMATION } from '@/libs/animations';

interface ShakeWrapperProps {
  /** Content to wrap */
  children: ReactNode;
  /** Whether to trigger the shake animation */
  isShaking: boolean;
  /** Callback when shake animation completes */
  onShakeComplete?: () => void;
  /** Additional className */
  className?: string;
}

/**
 * ShakeWrapper
 *
 * Wraps content and applies a shake animation when isShaking is true.
 * Useful for error states (e.g., trying to continue with no selection).
 *
 * Usage:
 * ```tsx
 * const [isShaking, setIsShaking] = useState(false);
 *
 * const handleContinue = () => {
 *   if (!hasSelection) {
 *     triggerHaptic('error');
 *     setIsShaking(true);
 *     return;
 *   }
 *   // proceed...
 * };
 *
 * <ShakeWrapper
 *   isShaking={isShaking}
 *   onShakeComplete={() => setIsShaking(false)}
 * >
 *   <ContinueButton onClick={handleContinue} />
 * </ShakeWrapper>
 * ```
 */
export function ShakeWrapper({
  children,
  isShaking,
  onShakeComplete,
  className = '',
}: ShakeWrapperProps) {
  const shakeVariants = {
    idle: { x: 0 },
    shake: {
      x: [0, -ANIMATION.shake.intensity, ANIMATION.shake.intensity, -ANIMATION.shake.intensity, ANIMATION.shake.intensity, 0],
      transition: {
        duration: ANIMATION.shake.duration / 1000,
        ease: 'easeInOut' as const,
      },
    },
  };

  return (
    <motion.div
      className={className}
      variants={shakeVariants}
      initial="idle"
      animate={isShaking ? 'shake' : 'idle'}
      onAnimationComplete={() => {
        if (isShaking) {
          onShakeComplete?.();
        }
      }}
    >
      {children}
    </motion.div>
  );
}
