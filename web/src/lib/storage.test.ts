import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entryFor, flip, rip } from '../test/fixtures';
import {
  addToHistory,
  clearHistory,
  HISTORY_KEY,
  HISTORY_MAX,
  loadHistory,
  loadSettings,
  resetStorageForTests,
  saveSettings,
  storageAvailable,
} from './storage';

beforeEach(() => {
  localStorage.clear();
  resetStorageForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetStorageForTests();
});

describe('settings', () => {
  it('defaults to a null threshold and round-trips a saved one', () => {
    expect(loadSettings()).toEqual({ profitThresholdCents: null });
    saveSettings({ profitThresholdCents: 2500 });
    resetStorageForTests();
    expect(loadSettings()).toEqual({ profitThresholdCents: 2500 });
  });

  it('ignores malformed settings', () => {
    localStorage.setItem('flip-or-rip:settings:v1', '{"profitThresholdCents":-4}');
    expect(loadSettings()).toEqual({ profitThresholdCents: null });
    localStorage.setItem('flip-or-rip:settings:v1', 'not json');
    expect(loadSettings()).toEqual({ profitThresholdCents: null });
  });
});

describe('history', () => {
  it('stores newest first', () => {
    addToHistory(entryFor(flip, { id: 'a' }));
    addToHistory(entryFor(rip, { id: 'b' }));
    expect(loadHistory().map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('caps at 50, dropping the oldest', () => {
    for (let i = 0; i < HISTORY_MAX + 3; i++) addToHistory(entryFor(flip, { id: `e${i}` }));
    const h = loadHistory();
    expect(h).toHaveLength(HISTORY_MAX);
    expect(h[0]!.id).toBe('e52');
    expect(h.at(-1)!.id).toBe('e3');
  });

  it('treats malformed JSON as empty and overwrites on the next save', () => {
    localStorage.setItem(HISTORY_KEY, '{broken');
    expect(loadHistory()).toEqual([]);
    addToHistory(entryFor(flip, { id: 'x' }));
    expect(JSON.parse(localStorage.getItem(HISTORY_KEY)!)).toHaveLength(1);
  });

  it('clears', () => {
    addToHistory(entryFor(flip));
    clearHistory();
    expect(loadHistory()).toEqual([]);
  });
});

describe('storage unavailable', () => {
  it('runs memory-only when localStorage throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    vi.stubGlobal('localStorage', throwing);
    resetStorageForTests();
    expect(storageAvailable()).toBe(false);
    expect(loadHistory()).toEqual([]);
    addToHistory(entryFor(flip, { id: 'm' }));
    expect(loadHistory().map((e) => e.id)).toEqual(['m']);
    saveSettings({ profitThresholdCents: 700 });
    expect(loadSettings()).toEqual({ profitThresholdCents: 700 });
    clearHistory();
    expect(loadHistory()).toEqual([]);
  });
});
