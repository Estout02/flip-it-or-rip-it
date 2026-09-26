// One screen: scan or type → verdict → next. Wires the lookup machine, device-local settings
// and history, the lazily loaded scanner, and the dialogs.
import type { FunctionComponent } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Header } from './components/Header';
import { LiveRegion } from './components/LiveRegion';
import { LookupForm, type LookupFormHandle } from './components/LookupForm';
import { RecentList } from './components/RecentList';
import { ResultPanel } from './components/ResultPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { announce } from './lib/announce';
import { DEFAULT_META, getMeta } from './lib/api';
import { formatCents } from './lib/money';
import { loadSettings, saveSettings, storageAvailable } from './lib/storage';
import type { LookupInput, Meta, Settings } from './lib/types';
import { useLookup } from './lib/use-lookup';
import { SCANNER_COPY, STORAGE_UNAVAILABLE } from './lib/verdict-copy';

type ScannerProps = { onCode(code: string): void; onCancel(): void; onTypeInstead(): void };

function cameraCapable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

export function App() {
  const lookup = useLookup();
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [meta, setMeta] = useState<Meta>(DEFAULT_META);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [ScannerView, setScannerView] = useState<FunctionComponent<ScannerProps> | null>(null);
  const [storageOk] = useState(() => storageAvailable());
  const [canScan] = useState(cameraCapable);

  const formRef = useRef<LookupFormHandle>(null);
  const scanButtonRef = useRef<HTMLButtonElement>(null);
  const settingsOpener = useRef<HTMLElement | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const loadingRef = useRef(false);
  loadingRef.current = lookup.state.status === 'loading';

  useEffect(() => {
    void getMeta().then(setMeta);
    if (!storageOk) announce(STORAGE_UNAVAILABLE, 'polite');
  }, []);

  const submit = useCallback(
    (input: Omit<LookupInput, 'profitThresholdCents'>) => {
      const full: LookupInput = { ...input };
      const t = settingsRef.current.profitThresholdCents;
      if (t !== null) full.profitThresholdCents = t;
      lookup.submit(full);
    },
    [lookup.submit],
  );

  const checkAnother = useCallback(() => formRef.current?.clear(), []);

  // Remember the opener explicitly: Safari doesn't focus buttons on click, so
  // document.activeElement can't be trusted to restore focus on close.
  const openSettings = (e: Event) => {
    settingsOpener.current = e.currentTarget as HTMLElement;
    setSettingsOpen(true);
  };

  // The scanner chunk (and its decoder) is imported only on the first Scan tap.
  const openScanner = async () => {
    if (!ScannerView) {
      try {
        const mod = await import('./scanner/scanner');
        setScannerView(() => mod.Scanner);
      } catch {
        announce(SCANNER_COPY.unsupported, 'assertive');
        formRef.current?.focusInput();
        return;
      }
    }
    setScanOpen(true);
  };

  const onCode = (code: string) => {
    setScanOpen(false);
    const form = formRef.current;
    if (!form) return;
    form.setValue(code);
    navigator.vibrate?.(50);
    if (loadingRef.current) {
      // A lookup is already in flight: don't fire another; let the user verify the code.
      announce(`Scanned ${code}`, 'polite');
      form.focusInput();
      return;
    }
    form.submit();
    // After submit, so "Checking…" doesn't replace the scan confirmation.
    announce(`Scanned ${code}. Checking…`, 'polite');
  };

  const threshold = settings.profitThresholdCents ?? meta.defaultProfitThresholdCents;

  return (
    <>
      <a class="skip-link" href="#lookup-input">
        Skip to lookup
      </a>
      <Header onOpenSettings={openSettings} />
      <main id="main" class="layout">
        <div class="col-lookup">
          <LookupForm
            handle={formRef}
            loading={lookup.state.status === 'loading'}
            serverError={lookup.fieldError}
            onFieldEdit={lookup.clearFieldError}
            onSubmit={submit}
            onScan={canScan ? () => void openScanner() : undefined}
            scanButtonRef={scanButtonRef}
          />
          <p class="threshold">
            <span>
              Minimum profit: <strong class="money">{formatCents(threshold)}</strong>
              {settings.profitThresholdCents === null && <span class="threshold__default"> (default)</span>}
            </span>
            <button type="button" class="btn-text" aria-haspopup="dialog" onClick={openSettings}>
              Edit<span class="visually-hidden"> minimum profit</span>
            </button>
          </p>
        </div>
        <div class="col-result">
          <ResultPanel
            shown={lookup.shown}
            meta={meta}
            onCheckAnother={checkAnother}
            onTryTitle={checkAnother}
            onRetry={lookup.retry}
            onScan={canScan ? () => void openScanner() : undefined}
          />
        </div>
        <div class="col-recent">
          <RecentList
            history={lookup.history}
            storageOk={storageOk}
            onSelect={lookup.showEntry}
            onClear={lookup.clearHistory}
          />
        </div>
      </main>

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        meta={meta}
        onSave={(cents) => {
          const next = { profitThresholdCents: cents };
          saveSettings(next);
          setSettings(next);
        }}
        onClose={() => {
          setSettingsOpen(false);
          settingsOpener.current?.focus();
        }}
      />

      {scanOpen && ScannerView && (
        <ScannerView
          onCode={onCode}
          onCancel={() => {
            setScanOpen(false);
            scanButtonRef.current?.focus();
          }}
          onTypeInstead={() => {
            setScanOpen(false);
            formRef.current?.focusInput();
          }}
        />
      )}

      <LiveRegion />
    </>
  );
}
