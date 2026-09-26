// Hand-drawn 24 px line icons. Decorative only: meaning always rides on adjacent text.
import type { ComponentChildren } from 'preact';
import type { IconName } from '../lib/verdict-copy';

const PATHS: Record<IconName, ComponentChildren> = {
  tag: (
    <>
      <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
      <path d="M13.5 17v-6M11 13.5l2.5-2.5 2.5 2.5" />
    </>
  ),
  hourglass: <path d="M6 3h12M6 21h12M7 3c0 4.5 5 5 5 9s-5 4.5-5 9M17 3c0 4.5-5 5-5 9s5 4.5 5 9" />,
  'heart-hand': (
    <>
      <path d="M12 11.5L8.9 8.4a2.1 2.1 0 0 1 3-3l.1.1.1-.1a2.1 2.1 0 0 1 3 3z" />
      <path d="M2.5 14.5H6l3 2.5h5a1.5 1.5 0 0 0 0-3h-2.5" />
      <path d="M14.5 17l4.6-2.3a1.6 1.6 0 0 1 1.6 2.7L15 21H6" />
      <path d="M2.5 21H6v-6.5" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="9" stroke-dasharray="3.2 2.4" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.6v.7M12 17h.01" />
    </>
  ),
  scan: (
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 8v8M10.5 8v8M13.5 8v8M16 8v8" />
  ),
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  alert: <path d="M10.3 4.2L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0zM12 9.5v4M12 17h.01" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
};

export function Icon({ name, class: className }: { name: IconName; class?: string }) {
  return (
    <svg
      class={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
