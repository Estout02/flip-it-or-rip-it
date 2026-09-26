import { fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flip, rip, risky, uncertain } from '../test/fixtures';
import { BasisNote } from './BasisNote';
import { MatchDetails } from './MatchDetails';

afterEach(() => vi.restoreAllMocks());

describe('MatchDetails', () => {
  it('shows the matched title and the competition read', () => {
    render(<MatchDetails result={flip} />);
    expect(screen.getByText(flip.matchedTitle!)).toBeTruthy();
    expect(screen.getByText('Matched:', { exact: false })).toBeTruthy();
    expect(screen.getByText('Low competition · 98 similar listings')).toBeTruthy();
  });

  it.each([
    ['MODERATE', 30, 'Some competition · 30 similar listings'],
    ['WEAK', 340, 'Crowded market · 340 similar listings'],
    ['UNPROVEN', 0, 'No other sellers listing this right now'],
  ] as const)('%s tier', (tier, n, text) => {
    render(<MatchDetails result={{ ...risky, liquidityTier: tier, competingSupplyCount: n }} />);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('badges a MEDIUM confidence match and not a HIGH one', () => {
    const { unmount } = render(<MatchDetails result={flip} />);
    expect(screen.queryByText('Likely match — check the title')).toBeNull();
    unmount();
    render(<MatchDetails result={rip} />);
    expect(screen.getByText('Likely match — check the title')).toBeTruthy();
  });

  it('uses the "Closest match" prefix when asked', () => {
    render(<MatchDetails result={uncertain} prefix="Closest match" />);
    expect(screen.getByText('Closest match:', { exact: false })).toBeTruthy();
  });

  it('offers "Show full title" only when the clamp hides text, and toggles it', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(120);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(48);
    render(<MatchDetails result={flip} />);
    const toggle = screen.getByRole('button', { name: 'Show full title' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    const less = screen.getByRole('button', { name: 'Show less' });
    expect(less.getAttribute('aria-expanded')).toBe('true');
  });

  it('no toggle when the title fits', () => {
    render(<MatchDetails result={flip} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('BasisNote', () => {
  it('is verbatim', () => {
    render(<BasisNote />);
    expect(
      screen.getByText(
        'Estimated from current eBay asking prices, adjusted toward typical sale prices. Competition counts similar active listings, not sales.',
      ),
    ).toBeTruthy();
  });
});
