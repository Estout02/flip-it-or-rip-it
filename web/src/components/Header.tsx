import type { Ref } from 'preact';
import { EnvBadge } from './EnvBadge';
import { Icon } from './Icon';
import { isTestEnv } from '../lib/verdict-copy';

type Props = { onOpenSettings(e: Event): void; settingsButtonRef?: Ref<HTMLButtonElement>; ebayEnv?: string };

export function Header({ onOpenSettings, settingsButtonRef, ebayEnv }: Props) {
  return (
    <header class={isTestEnv(ebayEnv) ? 'app-header app-header--badged' : 'app-header'}>
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
      <button
        type="button"
        class="btn btn--ghost header__settings"
        aria-haspopup="dialog"
        ref={settingsButtonRef}
        onClick={onOpenSettings}
      >
        <Icon name="settings" />
        <span class="header__settings-text">Settings</span>
      </button>
    </header>
  );
}
