// Shared helpers for App-level tests: a routed fetch stub and small interaction helpers.
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { expect, vi } from 'vitest';
import { App } from '../app';
import { resetMetaForTests } from '../lib/api';
import { resetStorageForTests } from '../lib/storage';
import type { Meta } from '../lib/types';
import { jsonResponse } from './fixtures';

export const META: Meta = { defaultProfitThresholdCents: 1000, lookupDailyCap: 50, marketplaceId: 'EBAY_US' };

export type LookupHandler = (body: Record<string, unknown>) => Response | Promise<Response>;

export function mockApi(handler: LookupHandler, meta: Meta | null = META) {
  const lookups: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path === '/api/meta') return meta !== null ? jsonResponse(meta) : new Response('boom', { status: 500 });
    if (path === '/api/lookup') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      lookups.push(body);
      return handler(body);
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, lookups };
}

export function renderApp() {
  resetMetaForTests();
  resetStorageForTests();
  const utils = render(<App />);
  const input = screen.getByLabelText('Barcode or item name') as HTMLInputElement;
  return { ...utils, input };
}

export function typeAndSubmit(input: HTMLInputElement, value: string) {
  fireEvent.input(input, { target: { value } });
  fireEvent.submit(input.form!);
}

/** The single result sheet, at either width. */
export function sheet(container: Element): HTMLElement | null {
  return container.querySelector('.sheet');
}

/** Types and submits, then waits for the sheet to expand. Re-parenting the lookup group across
 * a resting → expanded transition detaches `input` (T032's "one ordered block" moves into
 * `ResultPanel` instead), so this looks the sheet up fresh from `document` rather than from it. */
export async function expandSheet(input: HTMLInputElement, value: string): Promise<void> {
  typeAndSubmit(input, value);
  await waitFor(() => expect(document.querySelector('.sheet--expanded, .sheet--pane')).toBeTruthy());
}

/** Clicks Scan and waits for the live camera ground to mount. */
export async function startCamera(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
  await waitFor(() => expect(document.querySelector('.ground--camera')).toBeTruthy());
}
