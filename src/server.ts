import Fastify from 'fastify';
import { computeVerdict } from './lib/verdict.js';

const DEFAULT_THRESHOLD_CENTS = Math.round(
  Number(process.env.PROFIT_THRESHOLD_DEFAULT ?? 10) * 100,
);

const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok' }));

interface LookupBody {
  /** Item name or barcode-resolved title to search eBay for. */
  title?: string;
  /** UPC/ISBN/EAN from a barcode scan. */
  identifier?: string;
  /** What the user paid for the item, in dollars. Defaults to 0 (stuff they already own). */
  costBasis?: number;
  /** Per-request override of the flip/rip threshold, in dollars. */
  profitThreshold?: number;
}

app.post<{ Body: LookupBody }>('/api/lookup', async (request, reply) => {
  const { title, identifier, costBasis = 0, profitThreshold } = request.body ?? {};
  if (!title && !identifier) {
    return reply.code(400).send({ error: 'Provide a title or an identifier (UPC/ISBN/EAN).' });
  }

  // TODO(ebay): resolve identifier → catalog title, then query eBay sold listings.
  // TODO(shipping): estimate shipping from item weight/category.
  // Stubbed sold data so the pipeline is exercisable end-to-end in the sandbox.
  const soldPricesCents = [3500, 4200, 3900, 4100, 3800];
  const activeListingCount = 12;
  const shippingEstimateCents = 550;

  const result = computeVerdict({
    soldPricesCents,
    activeListingCount,
    shippingEstimateCents,
    costBasisCents: Math.round(costBasis * 100),
    profitThresholdCents:
      profitThreshold != null ? Math.round(profitThreshold * 100) : DEFAULT_THRESHOLD_CENTS,
  });

  return {
    query: { title: title ?? null, identifier: identifier ?? null },
    stubbed: true,
    ...result,
  };
});

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
