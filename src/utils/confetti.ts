import confetti from 'canvas-confetti';

/**
 * Triggers a luxury champagne & gold confetti burst
 * Used for reward redemption celebrations
 */
export const triggerLuxuryConfetti = () => {
  const duration = 1200;
  const end = Date.now() + duration;

  // THE CHAMPAGNE PALETTE
  const colors = [
    '#D6A249', // Metallic Gold
    '#FDF7F0', // Ivory Cream
    '#E5DDD5', // Warm Taupe
    '#FFFFFF', // Diamond White
  ];

  (function frame() {
    // Left Burst
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 55,
      origin: { x: 0.1, y: 0.8 },
      colors,
      zIndex: 9999,
    });

    // Right Burst
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 55,
      origin: { x: 0.9, y: 0.8 },
      colors,
      zIndex: 9999,
    });

    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  })();

  // CENTER EXPLOSION (The Pop)
  setTimeout(() => {
    confetti({
      particleCount: 150,
      spread: 100,
      origin: { y: 0.7 },
      colors,
      gravity: 1.2,
      scalar: 1.2,
      zIndex: 9999,
    });
  }, 200);
};
