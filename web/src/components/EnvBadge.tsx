// Spec 007 (plan D3): persistent "Test data" pill for any non-production eBay environment.
import { Icon } from './Icon';
import { isTestEnv, TEST_DATA_EXPLAIN, TEST_DATA_LABEL, TEST_DATA_WIDE } from '../lib/verdict-copy';
//
// The pill's box is always in the DOM, at its full size, from the very first paint — even before
// `/api/meta` resolves (env undefined) and even in production (env stays "production" forever).
// Only its *visibility* depends on the environment (contracts/sheet-states.md:185, "reserves its
// space so its arrival does not shift sheet content"): a conditional mount, however styled, cannot
// give that guarantee, because the header's flex layout has to redistribute width the instant the
// node appears or disappears. `visibility: hidden` (app.css `.env-badge--hidden`) keeps the box's
// footprint while removing it from both the visual and the accessibility tree, so production and
// the pre-load state read exactly as before: nothing.
export function EnvBadge({ env }: { env?: string }) {
  const active = isTestEnv(env);
  return (
    <p class={active ? 'env-badge' : 'env-badge env-badge--hidden'} aria-hidden={active ? undefined : 'true'}>
      <Icon name="flask" class="icon--chip" />
      <span>{TEST_DATA_LABEL}</span>
      <span class="env-badge__wide">{TEST_DATA_WIDE}</span>
      <span class="visually-hidden">{TEST_DATA_EXPLAIN}</span>
    </p>
  );
}
