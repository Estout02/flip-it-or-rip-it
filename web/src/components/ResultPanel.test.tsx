import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_META } from '../lib/api';
import { NO_MARKET_REASON, SANDBOX_NO_MARKET } from '../lib/verdict-copy';
import type { LookupState } from '../lib/types';
import { entryFor, flip, noMarket, rip, risky, uncertain } from '../test/fixtures';
import { EmptyState, ResultPanel } from './ResultPanel';

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

  it('EmptyState: the extracted markup used by the resting sheet', () => {
    render(<EmptyState />);
    const h = screen.getByRole('heading', { level: 2, name: 'Scan or type an item' });
    expect(h.id).toBe('result-heading');
    expect(h.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByText("You'll get a verdict — flip it or rip it — with the numbers behind it.")).toBeTruthy();
    expect(document.activeElement).not.toBe(h);
  });

  it('S1 loading: busy skeleton, no result-heading', () => {
    const { container } = renderPanel({ status: 'loading', input: { title: 'x' } });
    const section = container.querySelector('section')!;
    expect(section.getAttribute('aria-busy')).toBe('true');
    expect(section.getAttribute('aria-label')).toBe('Result');
    expect(container.querySelector('.skeleton')).toBeTruthy();
    expect(container.querySelector('#result-heading')).toBeNull();
  });

  describe('S8–S11 error panels', () => {
    it('S8 limit: heading, body and the #recent anchor (no onOpenRecent)', () => {
      renderPanel({ status: 'error', error: { kind: 'limit' }, input: {} });
      expect(screen.getByRole('heading', { name: "You've hit today's limit" })).toBeTruthy();
      const link = screen.getByRole('link', { name: 'Your recent lookups are still here.' });
      expect(link.getAttribute('href')).toBe('#recent');
    });

    it('S8 limit with onOpenRecent: a button, not a link', () => {
      const onOpenRecent = vi.fn();
      renderPanel({ status: 'error', error: { kind: 'limit' }, input: {} }, { onOpenRecent });
      const button = screen.getByRole('button', { name: 'Your recent lookups are still here.' });
      fireEvent.click(button);
      expect(onOpenRecent).toHaveBeenCalled();
      expect(screen.queryByRole('link', { name: 'Your recent lookups are still here.' })).toBeNull();
    });

    it.each([
      ['unavailable', "eBay isn't answering"],
      ['offline', "You're offline"],
      ['unexpected', 'Something went wrong'],
    ] as const)('S9/S10/S11 %s: heading, copy and Try again', (kind, heading) => {
      const { props } = renderPanel({ status: 'error', error: { kind }, input: {} });
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(props.onRetry).toHaveBeenCalled();
    });
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

  it("R-D ground='static': exactly one action button, 'Check another'", () => {
    const { container } = renderPanel(success(flip), { ground: 'static' });
    const buttons = container.querySelectorAll('.actions button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toBe('Check another');
  });

  it("R-D ground='camera': primary 'Scan the next one' plus a .btn-text 'Check another'", () => {
    const onScanNext = vi.fn();
    const { props } = renderPanel(success(flip), { ground: 'camera', onScanNext });
    const primary = screen.getByRole('button', { name: 'Scan the next one' });
    expect(primary.classList.contains('btn--primary')).toBe(true);
    fireEvent.click(primary);
    expect(onScanNext).toHaveBeenCalled();
    const secondary = screen.getByRole('button', { name: 'Check another' });
    expect(secondary.classList.contains('btn-text')).toBe(true);
    fireEvent.click(secondary);
    expect(props.onCheckAnother).toHaveBeenCalled();
  });

  it('visible=false: heading renders but focus is not stolen', async () => {
    renderPanel(success(flip), { visible: false });
    const h = screen.getByRole('heading', { name: 'Flip it' });
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).not.toBe(h);
  });

  it('visible flipping false → true for the same shown object focuses once, not twice', async () => {
    const s = success(flip);
    const { rerender, props } = renderPanel(s, { visible: false });
    const h = screen.getByRole('heading', { name: 'Flip it' });
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).not.toBe(h);
    rerender(<ResultPanel {...props} shown={s} visible />);
    await waitFor(() => expect(document.activeElement).toBe(h));
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    rerender(<ResultPanel {...props} shown={s} visible />);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it('R-C: .result__body children appear in the fixed DOM order', () => {
    const { container } = renderPanel(success(flip));
    const body = container.querySelector('.result__body')!;
    const firstClass = (el: Element) => el.className.split(' ')[0];
    const classes = Array.from(body.children).map(firstClass);
    expect(classes).toEqual(['capsule', 'verdict__reason', 'verdict__eyebrow', 'match', 'breakdown', 'basis-note', 'actions']);
  });

  it('S5 UNCERTAIN: suggestions, closed rough figures, no donate/recycle words', () => {
    const onScan = vi.fn();
    const { container } = renderPanel(success(uncertain), { onScan });
    expect(screen.getByRole('heading', { name: "Can't tell" })).toBeTruthy();
    expect(container.querySelector('.capsule--unc')).toBeTruthy();
    expect(container.querySelector('.net')).toBeNull();
    expect(container.textContent).not.toContain('in your pocket');
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
    expect(screen.getByText(NO_MARKET_REASON)).toBeTruthy();
    expect(container.querySelector('dl')).toBeNull();
    expect(container.querySelector('.net')).toBeNull();
    expect(container.querySelector('.figures__row')).toBeNull();
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

  it('loss case: minus-signed figure and the loss caption (US4-4)', () => {
    const { container } = renderPanel(success({ ...flip, profitCents: -320 }));
    expect(container.querySelector('.net--loss')).toBeTruthy();
    expect(screen.getByText('−$3.20')).toBeTruthy();
    expect(screen.getByText('out of pocket — a loss')).toBeTruthy();
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

  describe('sandbox no-market sentence (spec 007, US2)', () => {
    const SANDBOX_META = { ...DEFAULT_META, ebayEnv: 'sandbox' as const };
    const PROD_META = { ...DEFAULT_META, ebayEnv: 'production' as const };

    it('sandbox meta: sentence shown as a sandbox-note paragraph', () => {
      renderPanel(success(noMarket), { meta: SANDBOX_META });
      const p = screen.getByText(SANDBOX_NO_MARKET);
      expect(p.tagName).toBe('P');
      expect(p.classList.contains('sandbox-note')).toBe(true);
    });

    it('production meta: no sentence', () => {
      renderPanel(success(noMarket), { meta: PROD_META });
      expect(screen.queryByText(SANDBOX_NO_MARKET)).toBeNull();
    });

    it('unknown meta (default): no sentence', () => {
      renderPanel(success(noMarket));
      expect(screen.queryByText(SANDBOX_NO_MARKET)).toBeNull();
    });

    it('other verdicts never show it, even in sandbox', () => {
      renderPanel(success(flip), { meta: SANDBOX_META });
      expect(screen.queryByText(SANDBOX_NO_MARKET)).toBeNull();
      renderPanel(success(uncertain), { meta: SANDBOX_META });
      expect(screen.queryByText(SANDBOX_NO_MARKET)).toBeNull();
    });

    it('history entry checked in sandbox, viewed under production meta: shown', () => {
      renderPanel(
        { status: 'success', entry: { ...entryFor(noMarket), ebayEnv: 'sandbox' }, fromHistory: true },
        { meta: PROD_META },
      );
      expect(screen.getByText(SANDBOX_NO_MARKET)).toBeTruthy();
    });

    it('legacy history entry (no ebayEnv), viewed under sandbox meta: not shown', () => {
      renderPanel({ status: 'success', entry: entryFor(noMarket), fromHistory: true }, { meta: SANDBOX_META });
      expect(screen.queryByText(SANDBOX_NO_MARKET)).toBeNull();
    });
  });

  describe('history env note (spec 007, US3)', () => {
    const SANDBOX_META = { ...DEFAULT_META, ebayEnv: 'sandbox' as const };
    const PROD_META = { ...DEFAULT_META, ebayEnv: 'production' as const };

    it('history entry checked in sandbox, viewed under production meta: env note shown', () => {
      renderPanel(
        { status: 'success', entry: { ...entryFor(flip), ebayEnv: 'sandbox' }, fromHistory: true },
        { meta: PROD_META },
      );
      expect(document.getElementById('result-env-note')!.textContent).toBe('Test data — eBay sandbox');
    });

    it('same entry live (not from history): no env note', () => {
      renderPanel(
        { status: 'success', entry: { ...entryFor(flip), ebayEnv: 'sandbox' }, fromHistory: false },
        { meta: SANDBOX_META },
      );
      expect(document.getElementById('result-env-note')).toBeNull();
    });

    it('legacy history entry (no ebayEnv): no env note', () => {
      renderPanel({ status: 'success', entry: entryFor(flip), fromHistory: true });
      expect(document.getElementById('result-env-note')).toBeNull();
    });

    it('history entry checked in production: no env note', () => {
      renderPanel({
        status: 'success',
        entry: { ...entryFor(flip), ebayEnv: 'production' },
        fromHistory: true,
      });
      expect(document.getElementById('result-env-note')).toBeNull();
    });
  });
});
