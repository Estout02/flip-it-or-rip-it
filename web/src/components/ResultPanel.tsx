// The result area: S0 empty, S1 loading, S2–S6 results, S8–S11 error panels, S12 from history.
import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { LookupError, LookupState, Meta } from '../lib/types';
import {
  DISMISS_SCAN_NEXT,
  EMPTY_BODY,
  EMPTY_HEADING,
  ERROR_COPY,
  isNoMarket,
  isTestEnv,
  nextUtcMidnightLocal,
  ROUGH_FIGURES_SUMMARY,
  SANDBOX_NO_MARKET,
  UNCERTAIN_SUGGEST_DETAILS,
  UNCERTAIN_SUGGEST_SCAN,
  VERDICT_COPY,
} from '../lib/verdict-copy';
import { BasisNote } from './BasisNote';
import { Icon } from './Icon';
import { MatchDetails } from './MatchDetails';
import { MoneyBreakdown } from './MoneyBreakdown';
import { RESULT_HEADING_ID, VerdictBanner } from './VerdictBanner';

export const APP_TITLE = 'Flip it or Rip it';

/** Desktop S0 (middle pane, always mounted) and the narrow resting sheet (T032) share this
 * markup — exactly one of the two surfaces renders it at a time (contracts/sheet-states.md rule 3). */
export function EmptyState() {
  return (
    <div class="empty">
      <h2 id={RESULT_HEADING_ID} class="empty__heading" tabIndex={-1}>
        {EMPTY_HEADING}
      </h2>
      <p class="empty__body">{EMPTY_BODY}</p>
    </div>
  );
}

type Props = {
  shown: LookupState;
  meta: Meta;
  /** False while the sheet is dismissed but a lookup is still resolving (research R13) — the
   * result lands and is announced/saved, but must not steal focus or re-open the sheet. */
  visible?: boolean;
  /** Which dismissal pair (R-D) the actions render. Desktop always passes 'static' (rule 6). */
  ground?: 'camera' | 'static';
  onCheckAnother(): void;
  onTryTitle(): void;
  onRetry(): void;
  /** Present only when the device can scan; powers S5's "Scan the barcode" suggestion. */
  onScan?: () => void;
  /** camera ground only: dismiss to the live viewfinder instead of collapsing to rest. */
  onScanNext?: () => void;
  /** S8: when provided, the "recent lookups" link becomes a button that opens Recent as a sheet. */
  onOpenRecent?: (e: Event) => void;
  /** Below 1024px (contract S1 row, behaviour rule 11) the expanded sheet is skeleton-only — no
   * Check button exists yet — so S1 itself takes focus. At desktop the submitter stays focused
   * (the form remains mounted in `.col-lookup`), so App passes this only at narrow width. Default
   * `false` keeps desktop's behaviour without ResultPanel inspecting the viewport itself. */
  focusLoading?: boolean;
};

export function ResultPanel({
  shown,
  meta,
  visible = true,
  ground = 'static',
  onCheckAnother,
  onTryTitle,
  onRetry,
  onScan,
  onScanNext,
  onOpenRecent,
  focusLoading = false,
}: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const lastFocused = useRef<LookupState | null>(null);

  // New result or error panel → focus its heading (announced by the screen reader). A state
  // that was already focused once (e.g. restored after an inline validation error) is skipped.
  // Skipped entirely while not visible (R13) — a stale result must not steal focus or reopen.
  useEffect(() => {
    if (!visible) return;
    if (shown.status !== 'success' && shown.status !== 'error') return;
    if (lastFocused.current === shown) return;
    lastFocused.current = shown;
    headingRef.current?.focus();
  }, [shown, visible]);

  // S1 < 1024px (contract behaviour rule 11): loading begins → focus the busy region itself,
  // since no heading and no Check button exist yet. Once the result lands, the effect above takes
  // over and moves focus on to #result-heading inside the same region. Gated by `visible` too
  // (R13) and by `focusLoading` so desktop — where the submitter should keep focus — is untouched.
  useEffect(() => {
    if (!focusLoading || !visible) return;
    if (shown.status !== 'loading') return;
    sectionRef.current?.focus();
  }, [shown, visible, focusLoading]);

  useEffect(() => {
    document.title =
      shown.status === 'success' ? `${VERDICT_COPY[shown.entry.result.verdict].label} · ${APP_TITLE}` : APP_TITLE;
  }, [shown]);

  let body: ComponentChildren;
  switch (shown.status) {
    case 'idle':
      body = <EmptyState />;
      break;
    case 'loading':
      body = (
        <div class="skeleton" aria-hidden="true">
          <div class="skeleton__band" />
          <div class="skeleton__line skeleton__line--wide" />
          <div class="skeleton__line" />
          <div class="skeleton__line" />
        </div>
      );
      break;
    case 'error':
      body = (
        <ErrorPanel error={shown.error} meta={meta} headingRef={headingRef} onRetry={onRetry} onOpenRecent={onOpenRecent} />
      );
      break;
    case 'success': {
      const { entry, fromHistory } = shown;
      const r = entry.result;
      const savedAt = fromHistory ? entry.checkedAt : undefined;
      const env = fromHistory ? entry.ebayEnv : meta.ebayEnv;
      const testData = fromHistory && isTestEnv(entry.ebayEnv);
      // R-D: the dismissal pair. 'camera' (narrow-only) dismisses to the live viewfinder by
      // default and offers "Check another" as the secondary escape; 'static' (including all of
      // desktop, rule 6) has nothing else to dismiss to, so it is a single primary button.
      const dismissalActions =
        ground === 'camera' ? (
          <>
            <button type="button" class="btn btn--primary" onClick={onScanNext}>
              {DISMISS_SCAN_NEXT}
            </button>
            <button type="button" class="btn-text" onClick={onCheckAnother}>
              Check another
            </button>
          </>
        ) : (
          <button type="button" class="btn btn--primary" onClick={onCheckAnother}>
            Check another
          </button>
        );
      let inner: ComponentChildren;
      if (isNoMarket(r)) {
        inner = (
          <>
            <VerdictBanner result={r} headingRef={headingRef} savedAt={savedAt} testData={testData} />
            {isTestEnv(env) && <p class="sandbox-note">{SANDBOX_NO_MARKET}</p>}
            <BasisNote />
            <div class="actions">
              {dismissalActions}
              {entry.query.identifier !== null && (
                <button type="button" class="btn" onClick={onTryTitle}>
                  Try the item name instead
                </button>
              )}
            </div>
          </>
        );
      } else if (r.verdict === 'UNCERTAIN') {
        inner = (
          <>
            <VerdictBanner result={r} headingRef={headingRef} savedAt={savedAt} testData={testData} />
            <ul class="suggestions" role="list">
              <li>
                {onScan ? (
                  <button type="button" class="btn suggestion" onClick={onScan}>
                    <Icon name="scan" />
                    {UNCERTAIN_SUGGEST_SCAN}
                  </button>
                ) : (
                  <span class="suggestion">
                    <Icon name="scan" />
                    {UNCERTAIN_SUGGEST_SCAN}
                  </span>
                )}
              </li>
              <li>
                <span class="suggestion">
                  <Icon name="check" />
                  {UNCERTAIN_SUGGEST_DETAILS}
                </span>
              </li>
            </ul>
            <MatchDetails result={r} prefix="Closest match" showCompetition={false} />
            <details class="rough">
              <summary>{ROUGH_FIGURES_SUMMARY}</summary>
              <MoneyBreakdown result={r} costBasisCents={entry.costBasisCents} unreliable />
            </details>
            <BasisNote />
            <div class="actions">{dismissalActions}</div>
          </>
        );
      } else {
        inner = (
          <>
            {/* R-C DOM order: match before breakdown, restored to the older visual order by CSS `order`. */}
            <VerdictBanner result={r} headingRef={headingRef} savedAt={savedAt} testData={testData} />
            <MatchDetails result={r} />
            <MoneyBreakdown result={r} costBasisCents={entry.costBasisCents} />
            <BasisNote />
            <div class="actions">{dismissalActions}</div>
          </>
        );
      }
      body = (
        <div class="result__body result-enter" key={`${entry.id}:${fromHistory}`}>
          {inner}
        </div>
      );
      break;
    }
  }

  const loading = shown.status === 'loading';
  return (
    <section
      ref={sectionRef}
      class="result"
      aria-labelledby={loading ? undefined : RESULT_HEADING_ID}
      aria-label={loading ? 'Result' : undefined}
      aria-busy={loading ? 'true' : undefined}
      tabIndex={loading ? -1 : undefined}
    >
      {body}
    </section>
  );
}

function ErrorPanel({
  error,
  meta,
  headingRef,
  onRetry,
  onOpenRecent,
}: {
  error: LookupError;
  meta: Meta;
  headingRef: RefObject<HTMLHeadingElement>;
  onRetry(): void;
  onOpenRecent?: (e: Event) => void;
}) {
  const heading = (text: string) => (
    <h2 id={RESULT_HEADING_ID} class="error-panel__heading" tabIndex={-1} ref={headingRef}>
      {text}
    </h2>
  );
  const retry = (
    <div class="actions">
      <button type="button" class="btn btn--primary" onClick={onRetry}>
        {ERROR_COPY.retry}
      </button>
    </div>
  );
  switch (error.kind) {
    case 'limit':
      return (
        <div class="error-panel result-enter">
          <Icon name="clock" class="error-panel__icon" />
          {heading(ERROR_COPY.limit.heading)}
          <p>{ERROR_COPY.limit.body(meta.lookupDailyCap, nextUtcMidnightLocal())}</p>
          <p>
            {onOpenRecent ? (
              <button type="button" class="btn-text" onClick={onOpenRecent}>
                {ERROR_COPY.limit.recent}
              </button>
            ) : (
              <a href="#recent" class="link">
                {ERROR_COPY.limit.recent}
              </a>
            )}
          </p>
        </div>
      );
    case 'unavailable':
    case 'offline':
    case 'unexpected': {
      const copy = ERROR_COPY[error.kind];
      return (
        <div class="error-panel result-enter">
          <Icon name="alert" class="error-panel__icon" />
          {heading(copy.heading)}
          <p>{copy.body}</p>
          {retry}
        </div>
      );
    }
    case 'validation':
      // S7 renders inline at the input; the hook never routes it here. Defensive fallback.
      return (
        <div class="error-panel">
          {heading(ERROR_COPY.unexpected.heading)}
          <p>{error.message}</p>
        </div>
      );
  }
}
