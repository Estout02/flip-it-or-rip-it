import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_META } from '../lib/api';
import type { Settings } from '../lib/types';
import { LiveRegion } from './LiveRegion';
import { SettingsDialog } from './SettingsDialog';

function Harness({ initial, onSave }: { initial: Settings; onSave(c: number | null): void }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(initial);
  return (
    <>
      <button type="button" id="opener" onClick={() => setOpen(true)}>
        Settings
      </button>
      <SettingsDialog
        open={open}
        settings={settings}
        meta={DEFAULT_META}
        onSave={(c) => {
          onSave(c);
          setSettings({ profitThresholdCents: c });
        }}
        onClose={() => {
          setOpen(false);
          document.getElementById('opener')!.focus();
        }}
      />
      <LiveRegion />
    </>
  );
}

function setup(initial: Settings = { profitThresholdCents: null }) {
  const onSave = vi.fn();
  render(<Harness initial={initial} onSave={onSave} />);
  const opener = screen.getByRole('button', { name: 'Settings' });
  fireEvent.click(opener);
  const dialog = document.querySelector('dialog')!;
  return { onSave, opener, dialog };
}

describe('SettingsDialog', () => {
  it('opens as a labelled dialog with the field, help text and default', async () => {
    const { dialog } = setup();
    await waitFor(() => expect(dialog.open).toBe(true));
    expect(screen.getByRole('dialog', { name: 'Your settings' })).toBe(dialog);
    const input = screen.getByLabelText('Minimum profit to flip ($)') as HTMLInputElement;
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(input.value).toBe('');
    expect(screen.getByText('Default: $10.00. Items below this come back as Rip it.')).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toBe('threshold-help');
    expect(document.activeElement).toBe(input);
  });

  it('pre-fills a saved threshold', async () => {
    setup({ profitThresholdCents: 2550 });
    await waitFor(() =>
      expect((screen.getByLabelText('Minimum profit to flip ($)') as HTMLInputElement).value).toBe('25.50'),
    );
  });

  it('Save validates, persists, announces and returns focus to the opener', async () => {
    const { onSave, opener, dialog } = setup();
    const input = screen.getByLabelText('Minimum profit to flip ($)') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(2500);
    await waitFor(() => expect(dialog.open).toBe(false));
    expect(document.activeElement).toBe(opener);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved'));
  });

  it('invalid input → inline error scoped to the dialog; nothing saved', () => {
    const { onSave, dialog } = setup();
    const input = screen.getByLabelText('Minimum profit to flip ($)') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '12.345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
    expect(screen.getByText('Minimum profit: Enter an amount like 12 or 12.50.')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('threshold-help threshold-error');
  });

  it('Use default saves null', () => {
    const { onSave } = setup({ profitThresholdCents: 2500 });
    fireEvent.click(screen.getByRole('button', { name: 'Use default' }));
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it('Close (and Escape, which closes the dialog natively) returns focus without saving', async () => {
    const { onSave, opener, dialog } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(dialog.open).toBe(false));
    expect(onSave).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });
});
