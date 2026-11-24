/** One easing for the console, and the single orchestrated moment: plates scanned in, one after another. */
export const ease = [0.2, 0.7, 0.2, 1] as const;
export const SCAN_STAGGER = 0.12;

export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
