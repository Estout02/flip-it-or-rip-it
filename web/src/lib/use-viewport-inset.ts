// Keeps `--kb-inset` in sync with the on-screen keyboard, so the sheet never grows under it
// (research R8, FR-006). A no-op wherever `visualViewport` doesn't exist.
import { useEffect } from 'preact/hooks';

export function useViewportInset(): void {
  useEffect(() => {
    const vv = typeof visualViewport !== 'undefined' ? visualViewport : null;
    if (!vv) return undefined;

    const update = () => {
      const layoutHeight = document.documentElement.clientHeight;
      const inset = Math.max(0, layoutHeight - (vv.height + vv.offsetTop));
      document.documentElement.style.setProperty('--kb-inset', `${inset}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      document.documentElement.style.removeProperty('--kb-inset');
    };
  }, []);
}
