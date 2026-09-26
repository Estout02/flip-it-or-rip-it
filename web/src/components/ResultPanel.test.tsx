import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_META } from '../lib/api';
import type { LookupState } from '../lib/types';
import { entryFor, flip, noMarket, rip, risky, uncertain } from '../test/fixtures';
import { ResultPanel } from './ResultPanel';

function renderPanel(shown: LookupState, extra: Partial<Parameters<typeof ResultPanel>[0]> = {}) {
  const props = {
    shown,
    meta: DEFAULT_META,
    onCheckAnother: vi.fn(),
    onTryTitle: vi.fn(),
    onRetry: vi.fn(),
    ...extra,
  };
  return { ...render(<ResultPanel {...props} />), props };
}

const success = (r: typeof flip, fromHistory = false): LookupState => ({
  status: 'success',
  entry: entryFor(r),
  fromHistory,
});

describe('ResultPanel', () => {
  it('S0 empty: explainer, no focus move', () => {
    renderPanel({ status: 'idle' });
    expect(screen.getByRole('heading', { level: 2, name: 'Scan or type an item' })).toBeTruthy();
    expect(screen.getByText("You'll get a verdict — flip it or rip it — with the numbers behind it.")).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
    expect(document.title).toBe('Flip it or Rip it');
  });

  it('S1 loading: busy skeleton', () => {
    const { container } = renderPanel({ status: 'loading', input: { title: 'x' } });
    expect(container.querySelector('section')!.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('.skeleton')).toBeTruthy();
  });

  it.each([
    [flip, 'Flip it'],
    [risky, 'Flip it — slow seller'],
    [rip, 'Rip it'],
  ])('S2–S4: banner, breakdown, match, basis note; focus on the verdict heading', async (r, label) => {
    const { container } = renderPanel(success(r));
    const h = screen.getByRole('heading', { level: 2, name: label });
    await waitFor(() => expect(document.activeElement).toBe(h));
    expect(container.querySelector('dl.figures')).toBeTruthy();
    expect(screen.getByText(r.matchedTitle!)).toBeTruthy();
    expect(screen.getByText(/^Estimated from current eBay asking prices/)).toBeTruthy();
    expect(document.title).toBe(`${label} · Flip it or Rip it`);
    expect(container.querySelector('section')!.getAttribute('aria-labelledby')).toBe('result-heading');
  });

  it('Check another calls onCheckAnother', () => {
    const { props } = renderPanel(success(flip));
    fireEvent.click(screen.getByRole('button', { name: 'Check another' }));
    expect(props.onCheckAnother).toHaveBeenCalled();
  });

  it('S5 UNCERTAIN: suggestions, closed rough figures, no donate/recycle words', () => {
    const onScan = vi.fn();
    const { container } = renderPanel(success(uncertain), { onScan });
    expect(screen.getByRole('heading', { name: "Can't tell" })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Scan the barcode if it has one' }));
    expect(onScan).toHaveBeenCalled();
    expect(screen.getByText('Add details: platform, edition, or year')).toBeTruthy();
    expect(screen.getByText('Closest match:', { exact: false })).toBeTruthy();
    const details = container.querySelector('details.rough') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('Show rough figures (unreliable)');
    expect(details.textContent).toContain('These figures may be for a different product.');
    expect(container.textContent!.toLowerCase()).not.toMatch(/donate|recycle/);
  });

  it('S5 without a scanner: the scan suggestion is plain text', () => {
    renderPanel(success(uncertain));
    expect(screen.queryByRole('button', { name: 'Scan the barcode if it has one' })).toBeNull();
    expect(screen.getByText('Scan the barcode if it has one')).toBeTruthy();
  });

  it('S6 no market data: overridden reason, no figures, try-the-name for barcodes', () => {
    const { container, props } = renderPanel(success(noMarket));
    expect(screen.getByRole('heading', { name: 'Rip it' })).toBeTruthy();
    expect(screen.getByText("No one is selling this on eBay right now, so there's no price to go on.")).toBeTruthy();
    expect(container.querySelector('dl')).toBeNull();
    expect(container.textContent).not.toContain('$0.00');
    fireEvent.click(screen.getByRole('button', { name: 'Try the item name instead' }));
    expect(props.onTryTitle).toHaveBeenCalled();
  });

  it('S6 for a title query has no try-the-name action', () => {
    renderPanel({
      status: 'success',
      entry: entryFor(noMarket, { query: { identifier: null, title: 'mystery' } }),
      fromHistory: false,
    });
    expect(screen.queryByRole('button', { name: 'Try the item name instead' })).toBeNull();
  });

  it('S12 from history: saved note and focus on the verdict heading', async () => {
    renderPanel(success(rip, true));
    expect(screen.getByText(/Saved result, not refreshed\./)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Rip it' })));
  });

  it('does not re-focus when the same state is shown again (after an inline validation error)', async () => {
    const s = success(flip);
    const { rerender, props } = renderPanel(s);
    await waitFor(() => expect(document.activeElement?.id).toBe('result-heading'));
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    rerender(<ResultPanel {...props} shown={{ status: 'loading', input: {} }} />);
    rerender(<ResultPanel {...props} shown={s} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(input);
    input.remove();
  });
});
