import { render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { announce } from '../lib/announce';
import { LiveRegion } from './LiveRegion';

describe('LiveRegion', () => {
  it('mounts one polite status and one assertive alert region', () => {
    render(<LiveRegion />);
    expect(screen.getByRole('status')).toHaveProperty('textContent', '');
    expect(screen.getByRole('alert')).toHaveProperty('textContent', '');
  });

  it('announces, and re-announces identical text by clearing first', async () => {
    render(<LiveRegion />);
    const status = screen.getByRole('status');
    announce('Checking…');
    await waitFor(() => expect(status.textContent).toBe('Checking…'));
    announce('Checking…');
    expect(status.textContent).toBe('');
    await waitFor(() => expect(status.textContent).toBe('Checking…'));
    announce('Bad input', 'assertive');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Bad input'));
  });
});
