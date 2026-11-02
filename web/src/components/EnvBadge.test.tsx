import { render } from '@testing-library/preact';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { EnvBadge } from './EnvBadge';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

describe('EnvBadge', () => {
  // The pill's box is always mounted, at full size, so its arrival can never resize the header
  // (contracts/sheet-states.md:185) — only its visibility (`.env-badge--hidden`, `aria-hidden`)
  // depends on the environment. "Nothing" now means invisible and unannounced, not absent.
  it('mounts a hidden placeholder with no env', () => {
    const { container } = render(<EnvBadge />);
    const p = container.querySelector('p.env-badge')!;
    expect(p).toBeTruthy();
    expect(p.classList.contains('env-badge--hidden')).toBe(true);
    expect(p.getAttribute('aria-hidden')).toBe('true');
  });

  it('mounts a hidden placeholder for production', () => {
    const { container } = render(<EnvBadge env="production" />);
    const p = container.querySelector('p.env-badge')!;
    expect(p).toBeTruthy();
    expect(p.classList.contains('env-badge--hidden')).toBe(true);
    expect(p.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders the pill for sandbox', () => {
    const { container } = render(<EnvBadge env="sandbox" />);
    const p = container.querySelector('p.env-badge')!;
    expect(p).toBeTruthy();
    expect(p.classList.contains('env-badge--hidden')).toBe(false);
    expect(p.hasAttribute('aria-hidden')).toBe(false);
    expect(p.textContent).toBe(
      "Test data — eBay sandbox. Results come from eBay's test environment, not real listings.",
    );
    expect(p.hasAttribute('role')).toBe(false);
    expect(p.hasAttribute('tabindex')).toBe(false);
    expect(p.hasAttribute('aria-live')).toBe(false);
    const wide = container.querySelector('.env-badge__wide')!;
    expect(wide.textContent).toBe(' — eBay sandbox');
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders the pill for any other non-production string', () => {
    const { container } = render(<EnvBadge env="staging" />);
    const p = container.querySelector('p.env-badge')!;
    expect(p.classList.contains('env-badge--hidden')).toBe(false);
  });

  it('has 0 axe violations for the sandbox render', async () => {
    const { container } = render(<EnvBadge env="sandbox" />);
    const results = await axe.run(container, { runOnly: { type: 'tag', values: TAGS } });
    expect(results.violations).toEqual([]);
  });

  it('has 0 axe violations for the hidden placeholder', async () => {
    const { container } = render(<EnvBadge env="production" />);
    const results = await axe.run(container, { runOnly: { type: 'tag', values: TAGS } });
    expect(results.violations).toEqual([]);
  });
});
