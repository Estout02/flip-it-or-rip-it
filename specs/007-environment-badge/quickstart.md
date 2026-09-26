# Quickstart: validating 007 Environment Badge

```bash
docker compose run --rm api npm test && docker compose run --rm api npm run typecheck
docker compose run --rm web npm test && docker compose run --rm web npm run typecheck
docker compose --profile e2e run --rm e2e          # includes e2e/env.spec.ts
```

Manual:

1. **Sandbox** (`docker compose up`, then open :5173): the header shows the "Test data" pill, and
   at desktop width it reads "Test data — eBay sandbox". Look up any real barcode. The no-market
   result adds the sandbox sentence, and the Recent entry shows a "Test data" chip.
2. **Production** (`docker compose down`, then
   `docker compose -f docker-compose.yml -f docker-compose.prod.yml up`): reload. There's no pill.
   The earlier Recent entry still shows "Test data", and reopening it shows the note. A new lookup's
   entry has no chip.
3. `curl -sI localhost:3000/api/meta | grep -i cache-control` → `no-cache`.
