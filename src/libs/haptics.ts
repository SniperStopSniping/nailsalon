/**
 * Haptics System
 *
 * Premium haptic feedback for mobile devices.
 * Desktop browsers ignore vibration (expected behavior).
 *
 * Usage:
 * ```tsx
 * import { triggerHaptic } from '@/libs/haptics';
 *
 * // On selection
 * onClick={() => {
 *   setSelected(id);
 *   triggerHaptic('select');
 * }}
 *
 * // On error
 * if (!isValid) {
 *   triggerHaptic('error');
 *   setShaking(true);
 * }
 * ```
 */

export type HapticType = 'select' | 'deselect' | 'confirm' | 'success' | 'error';

let hapticsEnabled = true;

/**
 * Enable or disable haptic feedback globally.
 * Useful for user preferences toggle.
 */
export function setHapticsEnabled(enabled: boolean): void {
  hapticsEnabled = enabled;
}

/**
 * Check if haptics are currently enabled.
 */
export function isHapticsEnabled(): boolean {
  return hapticsEnabled;
}

/**
 * Trigger haptic feedback on mobile devices.
 *
 * Patterns:
 * - select: 14ms (light tick for selections)
 * - deselect: 8ms (lighter tick for unselecting)
 * - confirm: 26ms (medium tick for continue/save)
 * - success: 35ms (booking complete, reward claimed)
 * - error: [50, 40] (double vibration for blocked actions)
 */
export function triggerHaptic(type: HapticType): void {
  if (!hapticsEnabled) return;
  if (typeof window === 'undefined') return;
  if (typeof window.navigator?.vibrate !== 'function') return;

  const patterns: Record<HapticType, number | number[]> = {
    select: 14,
    deselect: 8,
    confirm: 26,
    success: 35,
    error: [50, 40],
  };

  try {
    window.navigator.vibrate(patterns[type]);
  } catch {
    // Silently fail if vibration is not supported
  }
}
