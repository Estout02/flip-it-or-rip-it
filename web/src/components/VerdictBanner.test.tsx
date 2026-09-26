import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { flip, noMarket, rip, risky, uncertain } from '../test/fixtures';
import { VerdictBanner } from './VerdictBanner';

describe('VerdictBanner', () => {
  it.each([
    [flip, 'Flip it', 'Worth selling', 'verdict--flip'],
    [risky, 'Flip it — slow seller', 'Worth listing, expect to wait', 'verdict--risky'],
    [rip, 'Rip it', 'Not worth your time. Donate or recycle it.', 'verdict--rip'],
    [uncertain, "Can't tell", "We couldn't identify this item", 'verdict--unc'],
  ])('%#: label, eyebrow, icon and treatment', (result, label, eyebrow, cls) => {
    const { container } = render(<VerdictBanner result={result} />);
    const h = screen.getByRole('heading', { level: 2, name: label });
    expect(h.getAttribute('tabindex')).toBe('-1');
    expect(h.id).toBe('result-heading');
    expect(screen.getByText(eyebrow)).toBeTruthy();
    expect(container.querySelector('.verdict')!.classList.contains(cls)).toBe(true);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the API reason for normal verdicts', () => {
    render(<VerdictBanner result={flip} />);
    expect(screen.getByText(flip.reason)).toBeTruthy();
  });

  it('overrides the reason for UNCERTAIN and no-market', () => {
    render(<VerdictBanner result={uncertain} />);
    expect(
      screen.getByText("We found listings, but they don't agree on one product, so any price would be a guess."),
    ).toBeTruthy();
    render(<VerdictBanner result={noMarket} />);
    expect(screen.getByText("No one is selling this on eBay right now, so there's no price to go on.")).toBeTruthy();
  });

  it('renders the S12 saved-result note', () => {
    render(<VerdictBanner result={flip} savedAt={new Date().toISOString()} />);
    expect(screen.getByText(/^Checked .+\. Saved result, not refreshed\.$/)).toBeTruthy();
    // The note precedes the focused heading, so the heading is described by it (e2e finding).
    const h = screen.getByRole('heading', { level: 2 });
    expect(h.getAttribute('aria-describedby')).toBe('result-saved-note');
    expect(document.getElementById('result-saved-note')!.textContent).toMatch(/Saved result, not refreshed\.$/);
  });

  it('has no description on a fresh result', () => {
    render(<VerdictBanner result={flip} />);
    expect(screen.getByRole('heading', { level: 2 }).hasAttribute('aria-describedby')).toBe(false);
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
