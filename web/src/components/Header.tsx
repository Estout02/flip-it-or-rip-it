import type { Ref } from 'preact';
import { EnvBadge } from './EnvBadge';
import { Icon } from './Icon';
import { SCANNER_COPY } from '../lib/verdict-copy';

type Props = {
  onOpenSettings(e: Event): void;
  settingsButtonRef?: Ref<HTMLButtonElement>;
  ebayEnv?: string;
  onOpenRecent?(e: Event): void;
  recentButtonRef?: Ref<HTMLButtonElement>;
  onCancelCamera?(): void;
  cancelButtonRef?: Ref<HTMLButtonElement>;
};

// The chrome bar (spec 008 contracts/sheet-states.md "Document structure"): opaque, always on top,
// reachable while a result sheet is open (FR-026) because the sheet is never a modal (research R1).
export function Header({
  onOpenSettings,
  settingsButtonRef,
  ebayEnv,
  onOpenRecent,
  recentButtonRef,
  onCancelCamera,
  cancelButtonRef,
}: Props) {
  return (
    <header class="chrome">
      <h1 class="wordmark">
        <svg class="wordmark__mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false">
          <defs>
            <clipPath id="wordmark-clip">
              <rect x="1" y="1" width="30" height="30" rx="8" />
            </clipPath>
          </defs>
          <g clip-path="url(#wordmark-clip)">
            <path class="wordmark__flip" d="M0 0h32L0 32z" />
            <path class="wordmark__rip" d="M32 0v32H0z" />
          </g>
        </svg>
        <span class="wordmark__text">Flip it or Rip it</span>
      </h1>
      <EnvBadge env={ebayEnv} />
      {onOpenRecent && (
        <button type="button" class="chrome__btn" aria-haspopup="dialog" ref={recentButtonRef} onClick={onOpenRecent}>
          Recent
        </button>
      )}
      <button
        type="button"
        class="chrome__btn"
        aria-haspopup="dialog"
        ref={settingsButtonRef}
        onClick={onOpenSettings}
      >
        <Icon name="settings" />
        Settings
      </button>
      {onCancelCamera && (
        <button type="button" class="chrome__btn" ref={cancelButtonRef} onClick={onCancelCamera}>
          {SCANNER_COPY.cancel}
        </button>
      )}
    </header>
  );
}
