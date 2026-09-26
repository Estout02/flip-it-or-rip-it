// Spec 007 (plan D3): persistent "Test data" pill for any non-production eBay environment.
import { Icon } from './Icon';
import { isTestEnv, TEST_DATA_EXPLAIN, TEST_DATA_LABEL, TEST_DATA_WIDE } from '../lib/verdict-copy';

export function EnvBadge({ env }: { env?: string }) {
  if (!isTestEnv(env)) return null;
  return (
    <p class="env-badge">
      <Icon name="flask" class="icon--chip" />
      <span>{TEST_DATA_LABEL}</span>
      <span class="env-badge__wide">{TEST_DATA_WIDE}</span>
      <span class="visually-hidden">{TEST_DATA_EXPLAIN}</span>
    </p>
  );
}
