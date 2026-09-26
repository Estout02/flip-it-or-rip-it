// Shared helpers for App-level tests: a routed fetch stub and small interaction helpers.
import { fireEvent, render, screen } from '@testing-library/preact';
import { vi } from 'vitest';
import { App } from '../app';
import { resetMetaForTests } from '../lib/api';
import { resetStorageForTests } from '../lib/storage';
import type { Meta } from '../lib/types';
import { jsonResponse } from './fixtures';

export const META: Meta = { defaultProfitThresholdCents: 1000, lookupDailyCap: 50, marketplaceId: 'EBAY_US' };

export type LookupHandler = (body: Record<string, unknown>) => Response | Promise<Response>;

export function mockApi(handler: LookupHandler) {
  const lookups: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path === '/api/meta') return jsonResponse(META);
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
