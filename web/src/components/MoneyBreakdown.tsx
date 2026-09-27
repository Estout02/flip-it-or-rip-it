// S2 breakdown: hero net figure + caption, then a <dl> of the figures. rawAskingMedianCents and
// realizationRate are never displayed (FR-006). No separate "Profit" row — the hero carries that
// fact (FR-022).
import { formatCents } from '../lib/money';
import type { VerdictResult } from '../lib/types';
import { MONEY_ROWS, netCaption, ROUGH_FIGURES_NOTE } from '../lib/verdict-copy';

type Props = { result: VerdictResult; costBasisCents: number; unreliable?: boolean };

function Row({ term, cents }: { term: string; cents: number }) {
  return (
    <div class="figures__row">
      <dt>{term}</dt>
      <dd class="money">{formatCents(cents)}</dd>
    </div>
  );
}

export function MoneyBreakdown({ result, costBasisCents, unreliable = false }: Props) {
  const loss = result.profitCents < 0;
  return (
    <div class="breakdown">
      {unreliable ? (
        <p class="breakdown__note">{ROUGH_FIGURES_NOTE}</p>
      ) : (
        <p class={loss ? 'net net--loss' : 'net'}>
          <span class="net__figure money">{formatCents(result.profitCents)}</span>
          <span class="net__caption">{netCaption(result.profitCents)}</span>
        </p>
      )}
      <dl class="figures">
        <Row term={MONEY_ROWS.value} cents={result.estimatedValueCents} />
        <Row term={MONEY_ROWS.fees} cents={-result.feesCents} />
        <Row term={MONEY_ROWS.shipping} cents={-result.shippingEstimateCents} />
        {costBasisCents > 0 && <Row term={MONEY_ROWS.cost} cents={-costBasisCents} />}
      </dl>
    </div>
  );
}
