import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { describe, expect, it, vi } from 'vitest';
import { entryFor, flip, noMarket, risky, uncertain } from '../test/fixtures';
import { formatCheckedAt } from '../lib/verdict-copy';
import { RecentList } from './RecentList';

const now = new Date();
const history = [
  entryFor(risky, { id: 'b', checkedAt: now.toISOString() }),
  entryFor(flip, { id: 'a', checkedAt: now.toISOString() }),
];

describe('RecentList', () => {
  it('is a labelled section with id="recent" and the empty state', () => {
    render(<RecentList history={[]} storageOk onSelect={vi.fn()} onClear={vi.fn()} />);
    const section = document.getElementById('recent')!;
    expect(section.tagName).toBe('SECTION');
    expect(screen.getByRole('heading', { level: 2, name: 'Recent' })).toBeTruthy();
    expect(screen.getByText('Items you check will show up here.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Clear history/ })).toBeNull();
  });

  it('lists entries newest first with the accessible-name pattern', () => {
    render(<RecentList history={history} storageOk onSelect={vi.fn()} onClear={vi.fn()} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const [first, second] = items.map((li) => li.querySelector('button')!);
    const time = formatCheckedAt(history[0]!.checkedAt);
    expect(
      screen.getByRole('button', {
        name: `Flip it — slow seller: Rare Hardcover First Edition, +$99.10 profit, checked ${time}`,
      }),
    ).toBe(first);
    expect(second!.textContent).toContain('Flip it');
    // Label in name (2.5.3): the visible text carries "checked" too, in the same order.
    expect(first!.textContent).toContain(`· checked ${time}`);
  });

  it('never phrases an unmeasured value as profit', () => {
    render(
      <RecentList
        history={[entryFor(noMarket, { id: 'n' }), entryFor(uncertain, { id: 'u' })]}
        storageOk
        onSelect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText('no listings found')).toBeTruthy();
    expect(screen.getByText('no reliable price')).toBeTruthy();
  });

  it('selecting an entry calls onSelect with it (no lookup)', () => {
    const onSelect = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<RecentList history={history} storageOk onSelect={onSelect} onClear={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('listitem')[1]!.querySelector('button')!);
    expect(onSelect).toHaveBeenCalledWith(history[1]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Clear history asks first; Cancel is focused by default and keeps the list', async () => {
    const onClear = vi.fn();
    render(<RecentList history={history} storageOk onSelect={vi.fn()} onClear={onClear} />);
    const clearBtn = screen.getByRole('button', { name: 'Clear history' });
    fireEvent.click(clearBtn);
    const dialog = screen.getByRole('dialog', { name: 'Clear all recent lookups on this device?' });
    await waitFor(() => expect((dialog as HTMLDialogElement).open).toBe(true));
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.click(cancel);
    await waitFor(() => expect((dialog as HTMLDialogElement).open).toBe(false));
    expect(onClear).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(clearBtn);
  });

  it('Clear confirms and calls onClear', async () => {
    const onClear = vi.fn();
    render(<RecentList history={history} storageOk onSelect={vi.fn()} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('shows the storage-unavailable notice', () => {
    render(<RecentList history={[]} storageOk={false} onSelect={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText("Recent lookups can't be saved in this browser.")).toBeTruthy();
  });

  describe('test-data chip (spec 007)', () => {
    it('shows the chip and the name prefix for a sandbox entry', () => {
      render(
        <RecentList
          history={[{ ...entryFor(flip, { id: 's', checkedAt: now.toISOString() }), ebayEnv: 'sandbox' as const }]}
          storageOk
          onSelect={vi.fn()}
          onClear={vi.fn()}
        />,
      );
      const time = formatCheckedAt(now.toISOString());
      const button = screen.getByRole('button', {
        name: `Test data: Flip it: Chrono Trigger (Super Nintendo, 1995) — Cart Only, +$22.07 profit, checked ${time}`,
      });
      expect(button.firstElementChild!.classList.contains('chip--test')).toBe(true);
      expect(button.firstElementChild!.textContent).toBe('Test data');
    });

    it('shows no chip for a production entry', () => {
      render(
        <RecentList
          history={[{ ...entryFor(flip, { id: 'p', checkedAt: now.toISOString() }), ebayEnv: 'production' as const }]}
          storageOk
          onSelect={vi.fn()}
          onClear={vi.fn()}
        />,
      );
      expect(document.querySelector('.chip--test')).toBeNull();
      expect(document.querySelector('.recent-item')!.getAttribute('aria-label')).toMatch(/^Flip it: /);
    });

    it('shows no chip for a legacy entry with no recorded environment', () => {
      render(
        <RecentList
          history={[entryFor(flip, { id: 'l', checkedAt: now.toISOString() })]}
          storageOk
          onSelect={vi.fn()}
          onClear={vi.fn()}
        />,
      );
      expect(document.querySelector('.chip--test')).toBeNull();
      expect(document.querySelector('.recent-item')!.getAttribute('aria-label')).toMatch(/^Flip it: /);
    });
  });

  describe('presentation="sheet" (R9, below 1024px)', () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" id="opener" onClick={() => setOpen(true)}>
            Recent
          </button>
          <RecentList
            history={history}
            storageOk
            onSelect={vi.fn()}
            onClear={vi.fn()}
            presentation="sheet"
            open={open}
            onClose={() => {
              setOpen(false);
              document.getElementById('opener')!.focus();
            }}
          />
        </>
      );
    }

    it('opens as a modal dialog focused on the Recent heading', async () => {
      render(<Harness />);
      const dialog = document.querySelector('dialog.recent-sheet') as HTMLDialogElement;
      expect(dialog).toBeTruthy();
      await waitFor(() => expect(dialog.open).toBe(true));
      await waitFor(() => expect(document.activeElement).toBe(document.getElementById('recent-heading')));
    });

    it('has the same entries and accessible names as the pane', () => {
      render(<Harness />);
      const time = formatCheckedAt(history[0]!.checkedAt);
      expect(
        screen.getByRole('button', {
          name: `Flip it — slow seller: Rare Hardcover First Edition, +$99.10 profit, checked ${time}`,
        }),
      ).toBeTruthy();
    });

    it('renders the same empty state and storage notice as the pane', () => {
      render(
        <RecentList
          history={[]}
          storageOk={false}
          onSelect={vi.fn()}
          onClear={vi.fn()}
          presentation="sheet"
          open
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByText('Items you check will show up here.')).toBeTruthy();
      expect(screen.getByText("Recent lookups can't be saved in this browser.")).toBeTruthy();
    });

    it('Clear-history confirm still focuses Cancel first', async () => {
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
      const confirm = screen.getByRole('dialog', { name: 'Clear all recent lookups on this device?' });
      await waitFor(() => expect((confirm as HTMLDialogElement).open).toBe(true));
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    });

    it('the Close button closes it and returns focus to the opener', async () => {
      render(<Harness />);
      const dialog = document.querySelector('dialog.recent-sheet') as HTMLDialogElement;
      const opener = document.getElementById('opener')!;
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(dialog.open).toBe(false));
      expect(document.activeElement).toBe(opener);
    });

    // jsdom's <dialog> polyfill (src/test/setup.ts) implements open/close and the `close` event,
    // but not the native Escape-to-cancel behaviour real browsers give a modal dialog for free —
    // SettingsDialog.test.tsx notes the same limitation. Covered for real in e2e/errors.spec.ts.
    it('closing the dialog (as Escape would, natively) returns focus to the opener', async () => {
      render(<Harness />);
      const dialog = document.querySelector('dialog.recent-sheet') as HTMLDialogElement;
      const opener = document.getElementById('opener')!;
      dialog.close();
      await waitFor(() => expect(dialog.open).toBe(false));
      expect(document.activeElement).toBe(opener);
    });
  });
});
