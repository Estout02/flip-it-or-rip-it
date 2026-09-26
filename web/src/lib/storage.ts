// Device-local settings and history (research R10). Every access is guarded; when storage
// is unavailable (private mode, blocked, full) the app keeps working from memory.
import type { HistoryEntry, Settings } from './types';

export const SETTINGS_KEY = 'flip-or-rip:settings:v1';
export const HISTORY_KEY = 'flip-or-rip:history:v1';
export const HISTORY_MAX = 50;

const DEFAULT_SETTINGS: Settings = { profitThresholdCents: null };

let memSettings: Settings = DEFAULT_SETTINGS;
let memHistory: HistoryEntry[] = [];
let available: boolean | null = null;

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** True when localStorage accepts a write. Memoised; `resetStorageForTests` clears it. */
export function storageAvailable(): boolean {
  if (available !== null) return available;
  try {
    const s = store();
    if (!s) throw new Error('no storage');
    const probe = 'flip-or-rip:probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

function read(key: string): unknown {
  if (!storageAvailable()) return undefined;
  try {
    const raw = store()!.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): void {
  if (!storageAvailable()) return;
  try {
    store()!.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or blocked mid-session: fall back to memory silently; the in-memory copy is current.
  }
}

function isThreshold(v: unknown): v is number | null {
  return v === null || (Number.isInteger(v) && (v as number) >= 0);
}

export function loadSettings(): Settings {
  if (!storageAvailable()) return memSettings;
  const v = read(SETTINGS_KEY) as Partial<Settings> | undefined;
  if (v && typeof v === 'object' && isThreshold(v.profitThresholdCents)) {
    return { profitThresholdCents: v.profitThresholdCents };
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: Settings): void {
  memSettings = settings;
  write(SETTINGS_KEY, settings);
}

function isEntry(v: unknown): v is HistoryEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<HistoryEntry>;
  return typeof e.id === 'string' && typeof e.checkedAt === 'string' && !!e.result && typeof e.result === 'object';
}

export function loadHistory(): HistoryEntry[] {
  if (!storageAvailable()) return memHistory;
  const v = read(HISTORY_KEY);
  return Array.isArray(v) ? v.filter(isEntry).slice(0, HISTORY_MAX) : [];
}

/** Prepends the entry (newest first), caps at 50, persists, and returns the new list. */
export function addToHistory(entry: HistoryEntry): HistoryEntry[] {
  const next = [entry, ...loadHistory()].slice(0, HISTORY_MAX);
  memHistory = next;
  write(HISTORY_KEY, next);
  return next;
}

export function clearHistory(): void {
  memHistory = [];
  if (!storageAvailable()) return;
  try {
    store()!.removeItem(HISTORY_KEY);
  } catch {
    // ignore
  }
}

export function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // insecure context: fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function resetStorageForTests(): void {
  memSettings = DEFAULT_SETTINGS;
  memHistory = [];
  available = null;
}
