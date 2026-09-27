// One media query decides the whole desktop/narrow layout split (contracts/sheet-states.md).
import { useEffect, useState } from 'preact/hooks';

/** SSR/jsdom-safe: defaults to `false` when `matchMedia` is unavailable. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof matchMedia === 'function' ? matchMedia(query).matches : false));

  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const mql = matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
