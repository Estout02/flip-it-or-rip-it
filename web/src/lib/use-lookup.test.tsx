import { act, renderHook, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entryFor, flip, jsonResponse, rip } from '../test/fixtures';
import { loadHistory, resetStorageForTests } from './storage';
import { useLookup } from './use-lookup';

type Pending = { resolve: (r: Response) => void; reject: (e: unknown) => void; init?: RequestInit };
let pending: Pending[] = [];

const fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
  return new Promise<Response>((resolve, reject) => {
    const p: Pending = { resolve, reject, init };
    pending.push(p);
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
});

beforeEach(() => {
  pending = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  resetStorageForTests();
});
afterEach(() => vi.unstubAllGlobals());

describe('useLookup', () => {
  it('idle → loading → success, saving to history', async () => {
    const { result } = renderHook(() => useLookup());
    expect(result.current.state.status).toBe('idle');
    act(() => result.current.submit({ title: 'Chrono Trigger SNES' }));
    expect(result.current.state.status).toBe('loading');
    await act(async () => pending[0]!.resolve(jsonResponse(flip)));
    await waitFor(() => expect(result.current.state.status).toBe('success'));
    const s = result.current.state;
    if (s.status !== 'success') throw new Error('unreachable');
    expect(s.fromHistory).toBe(false);
    expect(s.entry.result).toEqual(flip);
    expect(s.entry.query).toEqual({ identifier: null, title: 'Chrono Trigger SNES' });
    expect(result.current.history).toHaveLength(1);
    expect(loadHistory()).toHaveLength(1);
  });

  it('discards a stale response (FR-007)', async () => {
    const { result } = renderHook(() => useLookup());
    act(() => result.current.submit({ title: 'first' }));
    act(() => result.current.submit({ title: 'second' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The first request was aborted; even if it resolved late, it must not render.
    await act(async () => pending[0]!.resolve(jsonResponse(flip)));
    await act(async () => pending[1]!.resolve(jsonResponse(rip)));
    await waitFor(() => expect(result.current.state.status).toBe('success'));
    const s = result.current.state;
    if (s.status !== 'success') throw new Error('unreachable');
    expect(s.entry.result.verdict).toBe('RIP');
    expect(result.current.history).toHaveLength(1);
  });

  it('a double submit of the same input keeps one fetch in flight', () => {
    const { result } = renderHook(() => useLookup());
    act(() => result.current.submit({ identifier: '9780345391803' }));
    act(() => result.current.submit({ identifier: '9780345391803' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retry re-sends the last input', async () => {
    const { result } = renderHook(() => useLookup());
    act(() => result.current.submit({ title: 'x', costBasisCents: 800 }));
    await act(async () => pending[0]!.resolve(jsonResponse({ error: 'temporarily-unavailable', message: 'm' }, 503)));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.shown).toMatchObject({ status: 'error', error: { kind: 'unavailable' } });
    act(() => result.current.retry());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(pending[1]!.init?.body))).toEqual({ title: 'x', costBasisCents: 800 });
  });

  it('a 400 surfaces as a field error and keeps the previous result shown', async () => {
    const { result } = renderHook(() => useLookup());
    act(() => result.current.submit({ title: 'ok' }));
    await act(async () => pending[0]!.resolve(jsonResponse(flip)));
    await waitFor(() => expect(result.current.shown.status).toBe('success'));
    const before = result.current.shown;
    act(() => result.current.submit({ identifier: '12345678' }));
    await act(async () =>
      pending[1]!.resolve(jsonResponse({ error: 'validation', message: 'Not a valid barcode.' }, 400)),
    );
    await waitFor(() => expect(result.current.fieldError).toBe('Not a valid barcode.'));
    expect(result.current.shown).toBe(before);
  });

  it('showEntry shows a stored result without fetching', () => {
    const { result } = renderHook(() => useLookup());
    const entry = entryFor(rip);
    act(() => result.current.showEntry(entry));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ status: 'success', entry, fromHistory: true });
  });

  it('showEntry during a lookup cancels it', async () => {
    const { result } = renderHook(() => useLookup());
    act(() => result.current.submit({ title: 'x' }));
    const entry = entryFor(rip);
    act(() => result.current.showEntry(entry));
    await act(async () => pending[0]!.resolve(jsonResponse(flip)));
    expect(result.current.state).toEqual({ status: 'success', entry, fromHistory: true });
  });
});
