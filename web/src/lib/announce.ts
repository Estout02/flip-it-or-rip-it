// Tiny announcer over the two live regions that <LiveRegion> mounts once at load.
export type Politeness = 'polite' | 'assertive';

const regions: Partial<Record<Politeness, HTMLElement>> = {};
const timers: Partial<Record<Politeness, ReturnType<typeof setTimeout>>> = {};

export function registerRegion(kind: Politeness, el: HTMLElement | null): void {
  if (el) regions[kind] = el;
  else delete regions[kind];
}

/**
 * Clears the region, then sets the text on the next tick, so an identical message is
 * re-announced (screen readers ignore a region whose text did not change).
 */
export function announce(message: string, kind: Politeness = 'polite'): void {
  const el = regions[kind];
  if (!el) return;
  clearTimeout(timers[kind]);
  el.textContent = '';
  timers[kind] = setTimeout(() => {
    el.textContent = message;
  }, 50);
}
