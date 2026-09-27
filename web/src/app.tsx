// One screen: scan or type → verdict → next. Wires the lookup machine, device-local settings and
// history, the lazily loaded viewfinder, and the sheet (spec 008, contracts/sheet-states.md).
//
// A single `desktop` flag (from useMediaQuery) decides the whole layout split: which columns
// render, where the lookup group lives, and whether the sheet is a bottom sheet or a pane. It is
// read once and threaded everywhere so the markup and the CSS breakpoint can never disagree.
import type { FunctionComponent } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Header } from './components/Header';
import { Icon } from './components/Icon';
import { LiveRegion } from './components/LiveRegion';
import { INPUT_ID, LookupForm, type LookupFormHandle } from './components/LookupForm';
import { RecentList } from './components/RecentList';
import { APP_TITLE, EmptyState, ResultPanel } from './components/ResultPanel';
import { Sheet } from './components/Sheet';
import { SettingsDialog } from './components/SettingsDialog';
import { announce } from './lib/announce';
import { DEFAULT_META, getMeta } from './lib/api';
import { formatCents } from './lib/money';
import type { ScanFailure } from './scanner/detect';
import { loadSettings, saveSettings, storageAvailable } from './lib/storage';
import type { HistoryEntry, LookupInput, Meta, Settings } from './lib/types';
import { useLookup } from './lib/use-lookup';
import { useMediaQuery } from './lib/use-media-query';
import { useViewportInset } from './lib/use-viewport-inset';
import { SCANNER_COPY, STORAGE_UNAVAILABLE } from './lib/verdict-copy';

/** Which surface is behind the sheet (data-model.md §1). Exactly one at a time. */
type Ground = { kind: 'static' } | { kind: 'camera'; lastCode: string | null } | { kind: 'unavailable'; reason: ScanFailure };

type Overlay = 'none' | 'recent' | 'settings';

type ViewfinderProps = {
  onCode(code: string): void;
  onFailure(reason: ScanFailure): void;
  suspendedCode: string | null;
  lastCode?: string | null;
  presentation?: 'ground' | 'card';
};

function cameraCapable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

function unavailableBody(reason: ScanFailure): string {
  if (reason === 'denied') return SCANNER_COPY.denied;
  if (reason === 'no-camera') return SCANNER_COPY.noCamera;
  return SCANNER_COPY.unsupported;
}

export function App() {
  const desktop = useMediaQuery('(min-width: 1024px)');
  useViewportInset();

  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [meta, setMeta] = useState<Meta>(DEFAULT_META);
  const lookup = useLookup(meta.ebayEnv);
  const [ground, setGround] = useState<Ground>({ kind: 'static' });
  const [sheetView, setSheetView] = useState<'resting' | 'expanded'>('resting');
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [ViewfinderView, setViewfinderView] = useState<FunctionComponent<ViewfinderProps> | null>(null);
  const [storageOk] = useState(() => storageAvailable());
  const [canScan] = useState(cameraCapable);

  const formRef = useRef<LookupFormHandle>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const recentButtonRef = useRef<HTMLButtonElement>(null);
  const typeInsteadRef = useRef<HTMLButtonElement>(null);
  const settingsOpener = useRef<HTMLElement | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const loadingRef = useRef(false);
  loadingRef.current = lookup.state.status === 'loading';
  const wasScanning = useRef(false);
  const selectedFromRecent = useRef(false);
  const prevGroundKind = useRef(ground.kind);

  useEffect(() => {
    void getMeta().then(setMeta);
    if (!storageOk) announce(STORAGE_UNAVAILABLE, 'polite');
  }, []);

  // FR-011 release trigger: leaving the scanning flow by focusing/typing in the lookup input.
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if ((e.target as HTMLElement | null)?.id !== INPUT_ID) return;
      setGround((g) => (g.kind === 'camera' ? { kind: 'static' } : g));
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  // FR-011 release trigger: leaving the scanning flow by opening Recent or Settings.
  useEffect(() => {
    if (overlay !== 'none') setGround((g) => (g.kind === 'camera' ? { kind: 'static' } : g));
  }, [overlay]);

  // FR-011: released on page hide; re-acquired on return, with no new permission prompt (the
  // browser remembers a granted permission — see data-model.md §1).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        setGround((g) => {
          if (g.kind !== 'camera') return g;
          wasScanning.current = true;
          return { kind: 'static' };
        });
      } else if (wasScanning.current) {
        wasScanning.current = false;
        setGround({ kind: 'camera', lastCode: null });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Entering the camera flow moves focus to the chrome Cancel button (contracts/sheet-states.md
  // S15 state-map row).
  useEffect(() => {
    if (ground.kind === 'camera' && prevGroundKind.current !== 'camera') cancelButtonRef.current?.focus();
    if (ground.kind === 'unavailable') typeInsteadRef.current?.focus();
    prevGroundKind.current = ground.kind;
  }, [ground]);

  // ResultPanel (which normally owns the document.title effect) isn't mounted while resting at
  // narrow widths, so nothing would ever set the title back to the plain app name after a result.
  useEffect(() => {
    if (!desktop && sheetView === 'resting') document.title = APP_TITLE;
  }, [desktop, sheetView]);

  // S7 (server validation): the result reverts to its pre-loading content, which the narrow sheet
  // has nowhere to show (the lookup group lives in the resting sheet, not the expanded one) — so
  // collapse to rest, where the inline error is visible next to the input.
  useEffect(() => {
    if (!desktop && lookup.state.status === 'error' && lookup.state.error.kind === 'validation') {
      setSheetView('resting');
    }
  }, [lookup.state, desktop]);

  const submit = useCallback(
    (input: Omit<LookupInput, 'profitThresholdCents'>) => {
      const full: LookupInput = { ...input };
      const t = settingsRef.current.profitThresholdCents;
      if (t !== null) full.profitThresholdCents = t;
      lookup.submit(full);
      setSheetView('expanded');
    },
    [lookup.submit],
  );

  // Collapsing to rest over a static ground remounts `<LookupForm>` (it only lives in the resting
  // sheet, T032) — so `formRef.current` is briefly null, and clearing/focusing it has to wait for
  // the remount to land rather than run inline.
  const pendingFormAction = useRef<'clear' | 'focus' | null>(null);
  useEffect(() => {
    if (sheetView !== 'resting' || !pendingFormAction.current) return;
    const action = pendingFormAction.current;
    pendingFormAction.current = null;
    if (action === 'clear') formRef.current?.clear();
    else formRef.current?.focusInput();
  }, [sheetView]);

  // Collapses the sheet, and — unless the camera is live — clears and focuses the input. Never
  // touches the lookup machine (research R13): a request dismissed mid-flight keeps running and is
  // still saved to history when it resolves.
  const dismiss = useCallback(() => {
    setSheetView('resting');
    if (ground.kind === 'camera') {
      setGround((g) => (g.kind === 'camera' ? { ...g, lastCode: null } : g));
      cancelButtonRef.current?.focus();
    } else {
      pendingFormAction.current = 'clear';
    }
  }, [ground.kind]);

  // The primary dismissal (R-D): unlike a bare Escape/back-gesture dismiss, "Check another"
  // resets the lookup machine back to idle — the fix that makes the resting/idle S0 copy return
  // reliably (it previously only cleared the input, leaving the last verdict on screen at desktop).
  const checkAnother = useCallback(() => {
    lookup.reset();
    dismiss();
  }, [lookup.reset, dismiss]);

  // R-D "camera" ground: dismiss to the live viewfinder; decoding resumes because lastCode clears.
  const scanNext = useCallback(() => {
    lookup.reset();
    setSheetView('resting');
    setGround((g) => (g.kind === 'camera' ? { ...g, lastCode: null } : g));
    cancelButtonRef.current?.focus();
  }, [lookup.reset]);

  // Remember the opener explicitly: Safari doesn't focus buttons on click, so
  // document.activeElement can't be trusted to restore focus on close.
  const openSettings = (e: Event) => {
    settingsOpener.current = e.currentTarget as HTMLElement;
    setOverlay('settings');
  };
  const closeSettings = () => {
    setOverlay('none');
    settingsOpener.current?.focus();
  };

  const openRecent = () => setOverlay('recent');
  const closeRecent = useCallback(() => {
    setOverlay('none');
    if (!selectedFromRecent.current) recentButtonRef.current?.focus();
    selectedFromRecent.current = false;
  }, []);

  const showEntry = useCallback((entry: HistoryEntry) => {
    selectedFromRecent.current = true;
    lookup.showEntry(entry);
    setSheetView('expanded');
    setOverlay('none');
  }, [lookup.showEntry]);

  // The viewfinder chunk (and its decoder) is imported only on the first Scan tap, so the typed
  // path never downloads it (FR-009, SC-004).
  const openScanner = useCallback(async () => {
    if (!ViewfinderView) {
      try {
        const mod = await import('./scanner/viewfinder');
        setViewfinderView(() => mod.Viewfinder);
      } catch {
        announce(SCANNER_COPY.unsupported, 'assertive');
        formRef.current?.focusInput();
        return;
      }
    }
    setGround({ kind: 'camera', lastCode: null });
  }, [ViewfinderView]);

  const cancelCamera = () => setGround({ kind: 'static' });

  const typeInstead = () => {
    setGround({ kind: 'static' });
    formRef.current?.focusInput();
  };

  const onCode = (code: string) => {
    setGround((g) => (g.kind === 'camera' ? { ...g, lastCode: code } : g));
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
    setSheetView('expanded');
    // After submit, so "Checking…" doesn't replace the scan confirmation.
    announce(`Scanned ${code}. Checking…`, 'polite');
  };

  const onScanFailure = (reason: ScanFailure) => setGround({ kind: 'unavailable', reason });

  const threshold = settings.profitThresholdCents ?? meta.defaultProfitThresholdCents;

  const viewfinder =
    ground.kind === 'camera' && ViewfinderView ? (
      <ViewfinderView
        onCode={onCode}
        onFailure={onScanFailure}
        suspendedCode={ground.lastCode}
        lastCode={ground.lastCode}
        presentation={desktop ? 'card' : 'ground'}
      />
    ) : null;

  const cameraNotice = ground.kind === 'unavailable' && (
    <div class="camera-notice">
      <Icon name="alert" />
      <h2>{SCANNER_COPY.unavailableHeading}</h2>
      <p>{unavailableBody(ground.reason)}</p>
      <button type="button" class="btn btn--primary" ref={typeInsteadRef} onClick={typeInstead}>
        {SCANNER_COPY.typeInstead}
      </button>
    </div>
  );

  const thresholdLine = (
    <p class="threshold">
      <span>
        Minimum profit: <strong class="money">{formatCents(threshold)}</strong>
        {settings.profitThresholdCents === null && <span class="threshold__default"> (default)</span>}
      </span>
      <button type="button" class="btn-text" aria-haspopup="dialog" onClick={openSettings}>
        Edit<span class="visually-hidden"> minimum profit</span>
      </button>
    </p>
  );

  const lookupForm = (
    <LookupForm
      handle={formRef}
      loading={lookup.state.status === 'loading'}
      serverError={lookup.fieldError}
      onFieldEdit={lookup.clearFieldError}
      onSubmit={submit}
      onScan={canScan ? () => void openScanner() : undefined}
    />
  );

  const skipToInput = (e: Event) => {
    e.preventDefault();
    setSheetView('resting');
    pendingFormAction.current = 'focus';
    formRef.current?.focusInput();
  };

  return (
    <>
      <a class="skip-link" href={`#${INPUT_ID}`} onClick={skipToInput}>
        Skip to lookup
      </a>
      {desktop ? <div class="ground ground--static" /> : (viewfinder ?? <div class="ground ground--static" />)}
      <Header
        onOpenSettings={openSettings}
        ebayEnv={meta.ebayEnv}
        onOpenRecent={!desktop ? openRecent : undefined}
        recentButtonRef={recentButtonRef}
        onCancelCamera={ground.kind === 'camera' ? cancelCamera : undefined}
        cancelButtonRef={cancelButtonRef}
      />
      <main id="main" class="layout">
        {desktop && (
          <div class="col-lookup">
            {viewfinder}
            {cameraNotice}
            {lookupForm}
            {thresholdLine}
          </div>
        )}
        <div class="col-result">
          {desktop ? (
            <Sheet view="expanded" onDismiss={dismiss} presentation="pane">
              <ResultPanel
                shown={lookup.shown}
                meta={meta}
                ground="static"
                onCheckAnother={checkAnother}
                onTryTitle={checkAnother}
                onRetry={lookup.retry}
                onScan={canScan ? () => void openScanner() : undefined}
              />
            </Sheet>
          ) : (
            <Sheet view={sheetView} onDismiss={dismiss} presentation="bottom">
              {sheetView === 'resting' ? (
                <>
                  <EmptyState />
                  {cameraNotice}
                  {lookupForm}
                  {thresholdLine}
                </>
              ) : (
                <ResultPanel
                  shown={lookup.shown}
                  meta={meta}
                  visible={sheetView === 'expanded'}
                  ground={ground.kind === 'camera' ? 'camera' : 'static'}
                  onCheckAnother={checkAnother}
                  onTryTitle={checkAnother}
                  onRetry={lookup.retry}
                  onScan={canScan ? () => void openScanner() : undefined}
                  onScanNext={scanNext}
                  onOpenRecent={openRecent}
                />
              )}
            </Sheet>
          )}
        </div>
        {desktop && (
          <div class="col-recent">
            <RecentList
              history={lookup.history}
              storageOk={storageOk}
              onSelect={showEntry}
              onClear={lookup.clearHistory}
              presentation="pane"
            />
          </div>
        )}
      </main>

      {!desktop && (
        <RecentList
          history={lookup.history}
          storageOk={storageOk}
          onSelect={showEntry}
          onClear={lookup.clearHistory}
          presentation="sheet"
          open={overlay === 'recent'}
          onClose={closeRecent}
        />
      )}

      <SettingsDialog
        open={overlay === 'settings'}
        settings={settings}
        meta={meta}
        onSave={(cents) => {
          const next = { profitThresholdCents: cents };
          saveSettings(next);
          setSettings(next);
        }}
        onClose={closeSettings}
      />

      <LiveRegion />
    </>
  );
}
