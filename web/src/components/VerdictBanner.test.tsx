import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { flip, noMarket, rip, risky, uncertain } from '../test/fixtures';
import { NO_MARKET_REASON, UNCERTAIN_REASON } from '../lib/verdict-copy';
import { VerdictBanner } from './VerdictBanner';

describe('VerdictBanner', () => {
  it.each([
    [flip, 'Flip it', 'Worth selling', 'capsule--flip', 'tag'],
    [risky, 'Flip it — slow seller', 'Worth listing, expect to wait', 'capsule--risky', 'hourglass'],
    [rip, 'Rip it', 'Not worth your time. Donate or recycle it.', 'capsule--rip', 'heart-hand'],
    [uncertain, "Can't tell", "We couldn't identify this item", 'capsule--unc', 'question'],
  ])('%#: label, eyebrow, icon and treatment', (result, label, eyebrow, cls, icon) => {
    const { container } = render(<VerdictBanner result={result} />);
    const h = screen.getByRole('heading', { level: 2, name: label });
    expect(h.getAttribute('tabindex')).toBe('-1');
    expect(h.id).toBe('result-heading');
    expect(screen.getByText(eyebrow)).toBeTruthy();
    expect(container.querySelector(`.capsule.${cls}`)).toBeTruthy();
    const svg = container.querySelector('.capsule svg')!;
    expect(svg.getAttribute('data-icon')).toBe(icon);
  });

  it('h2#result-heading is a descendant of .capsule and non-focusable by tab order', () => {
    const { container } = render(<VerdictBanner result={flip} />);
    const capsule = container.querySelector('.capsule')!;
    const h = capsule.querySelector('#result-heading')!;
    expect(h).toBeTruthy();
    expect(h.getAttribute('tabindex')).toBe('-1');
  });

  it('the capsule is immediately followed by the reason paragraph', () => {
    const { container } = render(<VerdictBanner result={flip} />);
    const capsule = container.querySelector('.capsule')!;
    expect(capsule.nextElementSibling!.classList.contains('verdict__reason')).toBe(true);
  });

  it('each verdict eyebrow renders verbatim', () => {
    for (const [result, eyebrow] of [
      [flip, 'Worth selling'],
      [risky, 'Worth listing, expect to wait'],
      [rip, 'Not worth your time. Donate or recycle it.'],
      [uncertain, "We couldn't identify this item"],
    ] as const) {
      const { unmount } = render(<VerdictBanner result={result} />);
      expect(screen.getByText(eyebrow)).toBeTruthy();
      unmount();
    }
  });

  it('shows the API reason for normal verdicts', () => {
    render(<VerdictBanner result={flip} />);
    expect(screen.getByText(flip.reason)).toBeTruthy();
  });

  it('overrides the reason for UNCERTAIN and no-market', () => {
    render(<VerdictBanner result={uncertain} />);
    expect(screen.getByText(UNCERTAIN_REASON)).toBeTruthy();
    render(<VerdictBanner result={noMarket} />);
    expect(screen.getByText(NO_MARKET_REASON)).toBeTruthy();
  });

  it('renders the S12 saved-result note before the capsule, and describes the heading', () => {
    const { container } = render(<VerdictBanner result={flip} savedAt={new Date().toISOString()} />);
    expect(screen.getByText(/^Checked .+\. Saved result, not refreshed\.$/)).toBeTruthy();
    const saved = container.querySelector('.verdict__saved')!;
    const capsule = container.querySelector('.capsule')!;
    expect(saved.compareDocumentPosition(capsule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const h = screen.getByRole('heading', { level: 2 });
    expect(h.getAttribute('aria-describedby')).toBe('result-saved-note');
  });

  it('has no description on a fresh result', () => {
    render(<VerdictBanner result={flip} />);
    expect(screen.getByRole('heading', { level: 2 }).hasAttribute('aria-describedby')).toBe(false);
  });

  it('the capsule contains only the dot, icon and label — no eyebrow, saved note or env note', () => {
    const { container } = render(
      <VerdictBanner result={flip} savedAt={new Date().toISOString()} testData />,
    );
    const capsule = container.querySelector('.capsule')!;
    expect(capsule.querySelector('.verdict__eyebrow')).toBeNull();
    expect(capsule.querySelector('.verdict__saved')).toBeNull();
    expect(capsule.querySelector('.env-note')).toBeNull();
  });

  describe('env note (spec 007, US3)', () => {
    it('savedAt with testData: env note and combined aria-describedby', () => {
      render(<VerdictBanner result={flip} savedAt="2026-09-26T19:42:00.000Z" testData />);
      const note = document.getElementById('result-env-note')!;
      expect(note.textContent).toBe('Test data — eBay sandbox');
      const h = screen.getByRole('heading', { level: 2 });
      expect(h.getAttribute('aria-describedby')).toBe('result-saved-note result-env-note');
    });

    it('savedAt without testData: no env note, single aria-describedby', () => {
      render(<VerdictBanner result={flip} savedAt="2026-09-26T19:42:00.000Z" />);
      expect(document.getElementById('result-env-note')).toBeNull();
      const h = screen.getByRole('heading', { level: 2 });
      expect(h.getAttribute('aria-describedby')).toBe('result-saved-note');
    });

    it('testData without savedAt: no env note, no aria-describedby', () => {
      render(<VerdictBanner result={flip} testData />);
      expect(document.getElementById('result-env-note')).toBeNull();
      expect(screen.getByRole('heading', { level: 2 }).hasAttribute('aria-describedby')).toBe(false);
    });
  });
});
