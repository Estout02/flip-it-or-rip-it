// What the app actually matched (for mismatch-spotting), confidence, and the competition read.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { VerdictResult } from '../lib/types';
import { competitionPhrase, MEDIUM_MATCH_BADGE } from '../lib/verdict-copy';
import { Icon } from './Icon';

type Props = { result: VerdictResult; prefix?: 'Matched' | 'Closest match'; showCompetition?: boolean };

export function MatchDetails({ result, prefix = 'Matched', showCompetition = true }: Props) {
  const titleRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);

  // The 2-line clamp applies below 1024 px only (CSS). Offer the toggle only when the clamp
  // actually hides text. Screen readers always get the full title; the clamp is visual.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [result.matchedTitle]);

  return (
    <div class="match">
      {result.matchedTitle && (
        <>
          <p ref={titleRef} class={expanded ? 'match__title' : 'match__title match__title--clamp'}>
            <span class="match__prefix">{prefix}: </span>
            <span class="match__name">{result.matchedTitle}</span>
          </p>
          {(clamped || expanded) && (
            <button
              type="button"
              class="btn-text match__toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Show less' : 'Show full title'}
            </button>
          )}
        </>
      )}
      {result.matchConfidence === 'MEDIUM' && result.verdict !== 'UNCERTAIN' && (
        <p class="badge">
          <Icon name="alert" class="icon--inline" />
          {MEDIUM_MATCH_BADGE}
        </p>
      )}
      {(showCompetition || result.matchedCategoryName) && (
        <ul class="facts" role="list">
          {result.matchedCategoryName && (
            <li>
              <span class="facts__term">Category</span> {result.matchedCategoryName}
            </li>
          )}
          {showCompetition && <li>{competitionPhrase(result.liquidityTier, result.competingSupplyCount)}</li>}
        </ul>
      )}
    </div>
  );
}
