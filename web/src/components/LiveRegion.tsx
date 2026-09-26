// Two visually hidden live regions, mounted at load and never re-created (ui-states "Global").
import { useEffect, useRef } from 'preact/hooks';
import { registerRegion } from '../lib/announce';

export function LiveRegion() {
  const polite = useRef<HTMLDivElement>(null);
  const assertive = useRef<HTMLDivElement>(null);
  useEffect(() => {
    registerRegion('polite', polite.current);
    registerRegion('assertive', assertive.current);
    return () => {
      registerRegion('polite', null);
      registerRegion('assertive', null);
    };
  }, []);
  return (
    <>
      <div ref={polite} class="visually-hidden" role="status" aria-live="polite" aria-atomic="true" />
      <div ref={assertive} class="visually-hidden" role="alert" aria-live="assertive" aria-atomic="true" />
    </>
  );
}
