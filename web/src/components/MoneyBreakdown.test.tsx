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
  it('shows the net figure, caption and three rows; no cost row at $0', () => {
    const { container } = render(<MoneyBreakdown result={flip} costBasisCents={0} />);
    expect(container.querySelector('.net__figure')!.textContent).toBe('$22.07');
    expect(container.querySelector('.net__caption')!.textContent).toBe('in your pocket');
    expect(rows(container)).toEqual([
      ['Sells for', '$31.20'],
      ['eBay fees', '−$4.13'],
      ['Shipping', '−$5.00'],
    ]);
  });

  it('shows the cost row when a cost was entered', () => {
    const r = { ...flip, profitCents: 1407 };
    const { container } = render(<MoneyBreakdown result={r} costBasisCents={800} />);
    const rowList = rows(container);
    expect(rowList).toHaveLength(4);
    expect(rowList[3]).toEqual(['What you paid', '−$8.00']);
    expect(container.querySelector('.net__figure')!.textContent).toBe('$14.07');
  });

  it('reads a loss with the loss caption and modifier class', () => {
    const { container } = render(<MoneyBreakdown result={{ ...flip, profitCents: -320 }} costBasisCents={0} />);
    expect(container.querySelector('.net__figure')!.textContent).toBe('−$3.20');
    expect(container.querySelector('.net__caption')!.textContent).toBe('out of pocket — a loss');
    expect(container.querySelector('.net--loss')).toBeTruthy();
  });

  it('never shows a Profit row or the total modifier', () => {
    const { container } = render(<MoneyBreakdown result={flip} costBasisCents={0} />);
    expect(rows(container).some(([term]) => term === 'Profit')).toBe(false);
    expect(container.querySelector('.figures__row--total')).toBeNull();
  });

  it('never displays the raw asking median', () => {
    const { container } = render(<MoneyBreakdown result={flip} costBasisCents={0} />);
    expect(container.textContent).not.toContain('$39.00');
  });

  it('unreliable: carries the different-product note instead of the net figure', () => {
    render(<MoneyBreakdown result={uncertain} costBasisCents={0} unreliable />);
    expect(screen.getByText('These figures may be for a different product.')).toBeTruthy();
    expect(document.querySelector('.net')).toBeNull();
  });
});
