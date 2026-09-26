import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { flip, uncertain } from '../test/fixtures';
import { MoneyBreakdown } from './MoneyBreakdown';

function rows(container: Element) {
  return [...container.querySelectorAll('.figures__row')].map((r) => [
    r.querySelector('dt')!.textContent,
    r.querySelector('dd')!.textContent,
  ]);
}

describe('MoneyBreakdown', () => {
  it('lists value, fees, shipping and profit; no cost row at $0', () => {
    const { container } = render(<MoneyBreakdown result={flip} costBasisCents={0} />);
    expect(screen.getByText('+$22.07 profit')).toBeTruthy();
    expect(rows(container)).toEqual([
      ['Est. sale value', '$31.20'],
      ['eBay fees', '−$4.13'],
      ['Shipping', '−$5.00'],
      ['Profit', '$22.07'],
    ]);
    expect(container.querySelector('dl')).toBeTruthy();
  });

  it('shows the cost row when a cost was entered', () => {
    const r = { ...flip, profitCents: 1407 };
    const { container } = render(<MoneyBreakdown result={r} costBasisCents={800} />);
    expect(rows(container)).toContainEqual(['What you paid', '−$8.00']);
  });

  it('reads a loss in words, not color alone', () => {
    render(<MoneyBreakdown result={{ ...flip, profitCents: -320 }} costBasisCents={0} />);
    expect(screen.getByText('loses $3.20')).toBeTruthy();
  });

  it('never displays the raw asking median', () => {
    const { container } = render(<MoneyBreakdown result={flip} costBasisCents={0} />);
    expect(container.textContent).not.toContain('$39.00');
  });

  it('unreliable: carries the different-product note instead of a hero profit', () => {
    render(<MoneyBreakdown result={uncertain} costBasisCents={0} unreliable />);
    expect(screen.getByText('These figures may be for a different product.')).toBeTruthy();
    expect(screen.queryByText('+$5.41 profit')).toBeNull();
  });
});
