<!--
Sync Impact Report
==================
Version change: (template, unversioned) → 1.0.0
Rationale: Initial ratification — all placeholders filled from founder-supplied
principles and docs/PROJECT_BRIEF.md + docs/EBAY_API_NOTES.md.

Modified principles: n/a (initial adoption)
Added sections:
- Core Principles (7): I. eBay Compliance Is Non-Negotiable; II. Latency First;
  III. Cost Discipline; IV. Spec-Driven Development; V. Sandbox-First Testing;
  VI. Money Is Integer Cents; VII. Extensible Verdict Pipeline
- Additional Constraints
- Development Workflow
- Governance
Removed sections: none (template placeholders replaced)

Templates checked:
- ✅ .specify/templates/plan-template.md — Constitution Check gate is filled
  dynamically per feature; no static edits required.
- ✅ .specify/templates/spec-template.md — no constitution references; aligned.
- ✅ .specify/templates/tasks-template.md — no constitution references; aligned.
- ✅ .specify/templates/checklist-template.md — no constitution references; aligned.
- ✅ CLAUDE.md — conventions already mirror these principles; no update needed.

Deferred TODOs: none.
-->

# Flip It or Rip It Constitution

## Core Principles

### I. eBay Compliance Is Non-Negotiable

A ban on the founder's eBay account, developer keys, or IP kills the project. Therefore:

- **Never scrape eBay** — no fetching eBay pages, no headless browsers, no third-party
  scraper services or gray-market "sold data" resellers that scrape on our behalf.
- All eBay data comes from **official eBay Developer Program APIs only**, authenticated
  with OAuth application tokens.
- All eBay calls happen **server-side from our API** — never from user devices carrying
  our keys.
- Development runs against the **eBay Sandbox** (`EBAY_ENV=sandbox`); production keys are
  used only once the integration is stable and only for real usage.
- Rate limits are respected proactively: our own limiter + cache in front of every eBay
  call, back off on 429s, and quota headroom checked via the Developer Analytics API
  (`getRateLimits`) rather than discovered by exhaustion.

No feature, deadline, or data gap justifies violating this principle. The sold-listings
gap is bridged by the compliant fallback in `docs/EBAY_API_NOTES.md` (Browse API
active-listings valuation until Marketplace Insights access is granted), never by scraping.

### II. Latency First

The product's core promise is a verdict faster than a manual eBay-app sold-listings check.
The scan-to-verdict path MUST feel instant.

- No heavy middleware, no blocking calls, and no synchronous non-essential work in the
  lookup hot path.
- Every addition to the lookup path (auth, logging, persistence, analytics) MUST justify
  its latency cost; anything deferrable runs after the verdict is returned.
- Performance regressions on the lookup path are release blockers, not backlog items.

### III. Cost Discipline

Every external call — eBay API, vision LLM, shipping lookup — costs money or quota.
Features that cannot be run profitably do not ship.

- Valuations MUST be cached by product identifier (UPC/ISBN/EAN/EPID) for ~24 hours; a
  repeated scan of the same product costs zero external calls.
- Per-user lookup caps are enforced in our API from day one, sized to keep aggregate
  usage well under the 5,000/day eBay app quota.
- Photo → vision-LLM item identification is explicitly **economics-gated**: it ships only
  if per-lookup cost is viable. Barcode-first is the MVP path.
- New features that add external calls MUST state their per-lookup cost and cap strategy
  in the spec/plan before implementation.

### IV. Spec-Driven Development

Features are built through the Spec Kit flow: `/speckit-specify` → `/speckit-plan` →
`/speckit-tasks` → `/speckit-implement` (with `/speckit-clarify` and `/speckit-analyze`
as needed). No ad-hoc feature work.

- Specs land in `specs/`; founder decisions recorded in `docs/PROJECT_BRIEF.md` feed them.
- Bug fixes and trivial maintenance may proceed directly, but anything that adds or
  changes product behavior goes through the flow.

### V. Sandbox-First Testing

All code, tests, and experiments run inside the Docker containers (`docker compose`),
not on the host. The containers exist specifically as a safe environment for AI-driven
development and testing.

- Tests: `docker compose run --rm api npm test`; typecheck likewise inside the container.
- Local `npm install` on the host is permitted only for editor IntelliSense.

### VI. Money Is Integer Cents

All monetary values — prices, fees, shipping, thresholds, profit — are handled as integer
**cents** everywhere in code, storage, and API payloads. Conversion to dollars happens
only at the display edge. No floats for money, ever.

### VII. Extensible Verdict Pipeline

The pipeline stays four separate, composable steps: **identification → valuation →
shipping → verdict**. Post-MVP features (one-tap listing, auto-drafts, saved inventory,
tax tracking, revaluation notifications) MUST be able to hook in after the verdict
without reworking the pipeline.

- No step may reach into another's internals; each communicates through explicit
  inputs/outputs.
- Shortcuts that fuse steps for convenience are constitution violations even if faster
  to write.

## Additional Constraints

- **Stack**: Node 24 + TypeScript + Fastify API (`src/server.ts`); Postgres 17 provisioned
  but unused until saved inventory lands post-MVP; Vitest for tests.
- **Stateless MVP**: the API holds no per-user server state beyond caching and rate-limit
  counters until the saved-inventory feature is specced.
- **Secrets**: eBay credentials live in `.env` (gitignored, from `.env.example`); never
  committed, never shipped to clients.
- **Valuation honesty**: while valuations derive from Browse API active listings, the
  result MUST be labeled as asking-price-based and the liquidity signal marked as
  supply-side only (see `docs/EBAY_API_NOTES.md`).

## Development Workflow

- Read `docs/PROJECT_BRIEF.md` before product decisions and `docs/EBAY_API_NOTES.md`
  before touching the eBay integration.
- The Spec Kit flow (Principle IV) is the unit of feature delivery; each feature's plan
  MUST pass the Constitution Check gate against this document before Phase 0 research.
- Reviews verify, at minimum: no scraping or client-side eBay calls (I), no new blocking
  work in the lookup path (II), caching/caps for any new external call (III), work traces
  to a spec (IV), tests run in Docker (V), money in cents (VI), pipeline step boundaries
  intact (VII).

## Governance

This constitution supersedes all other practices in this repository. Where CLAUDE.md,
templates, or specs conflict with it, the constitution wins and the conflicting artifact
is amended.

- **Amendments**: proposed as a PR editing this file, including a Sync Impact Report,
  version bump, and updates to any dependent templates/docs. The founder approves
  amendments.
- **Versioning**: semantic — MAJOR for removing/redefining a principle, MINOR for adding
  a principle or materially expanding guidance, PATCH for clarifications and wording.
- **Compliance review**: every `/speckit-plan` Constitution Check gates on this document;
  violations require an entry in the plan's Complexity Tracking table with a justification
  or the design is revised. Principle I admits no justified violations.

**Version**: 1.0.0 | **Ratified**: 2026-07-07 | **Last Amended**: 2026-07-07
