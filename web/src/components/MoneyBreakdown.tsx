// S2 breakdown: hero profit phrase + a <dl> of the figures. rawAskingMedianCents and
// realizationRate are never displayed (FR-006).
import { describeProfit, formatCents } from '../lib/money';
import type { VerdictResult } from '../lib/types';
import { ROUGH_FIGURES_NOTE } from '../lib/verdict-copy';

type Props = { result: VerdictResult; costBasisCents: number; unreliable?: boolean };

function Row({ term, cents, total }: { term: string; cents: number; total?: boolean }) {
  return (
    <div class={total ? 'figures__row figures__row--total' : 'figures__row'}>
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
        <p class={loss ? 'hero-profit hero-profit--loss money' : 'hero-profit money'}>
          {describeProfit(result.profitCents)}
        </p>
      )}
      <dl class="figures">
        <Row term="Est. sale value" cents={result.estimatedValueCents} />
        <Row term="eBay fees" cents={-result.feesCents} />
        <Row term="Shipping" cents={-result.shippingEstimateCents} />
        {costBasisCents > 0 && <Row term="What you paid" cents={-costBasisCents} />}
        <Row term="Profit" cents={result.profitCents} total />
      </dl>
    </div>
  );
}
