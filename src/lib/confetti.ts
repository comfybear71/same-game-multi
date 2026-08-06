/** Confetti burst when a same-game multi lands. No-op on SSR / reduced motion. */
export async function celebrateMultiLand(): Promise<void> {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const confetti = (await import("canvas-confetti")).default;
  const colors = ["#34d399", "#fbbf24", "#60a5fa", "#c084fc", "#f472b6"];

  confetti({
    particleCount: 90,
    spread: 100,
    origin: { y: 0.55, x: 0.5 },
    colors,
    zIndex: 9999,
  });

  const duration = 2800;
  const end = Date.now() + duration;

  const rain = () => {
    confetti({
      particleCount: 2,
      startVelocity: 12,
      ticks: 280,
      origin: { x: Math.random(), y: 0 },
      colors,
      gravity: 1.1,
      scalar: 1.05,
      drift: Math.random() * 0.4 - 0.2,
      zIndex: 9999,
    });
    if (Date.now() < end) requestAnimationFrame(rain);
  };

  rain();
}
