import { render } from '@testing-library/preact';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { EnvBadge } from './EnvBadge';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

describe('EnvBadge', () => {
  it('renders nothing with no env', () => {
    const { container } = render(<EnvBadge />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for production', () => {
    const { container } = render(<EnvBadge env="production" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the pill for sandbox', () => {
    const { container } = render(<EnvBadge env="sandbox" />);
    const p = container.querySelector('p.env-badge')!;
    expect(p).toBeTruthy();
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
    expect(container.querySelector('p.env-badge')).toBeTruthy();
  });

  it('has 0 axe violations for the sandbox render', async () => {
    const { container } = render(<EnvBadge env="sandbox" />);
    const results = await axe.run(container, { runOnly: { type: 'tag', values: TAGS } });
    expect(results.violations).toEqual([]);
  });
});
