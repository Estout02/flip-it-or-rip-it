# Feature Specification: Backend Hardening

**Feature Branch**: `005-backend-hardening`

**Created**: 2026-09-26

**Status**: Draft

**Input**: User description: "Backend hardening: fix correctness and abuse gaps found in the 2026-09-26 project review, before any frontend consumes the API." (full list of seven issues in the Background section below)

## Background

A project review on 2026-09-26 found the four shipped specs (001–004) implemented and tested, but
surfaced gaps that matter the moment a real frontend puts the API in front of users. Three change
answers or cost; four are robustness gaps.

| # | Gap | Consequence today |
|---|---|---|
| 1 | Liquidity supply on title searches counts the whole free-text result set | A real item reads as a "flooded market" because stickers and cases compete with it — a false RIP / FLIP_RISKY |
| 2 | A barcode lookup's cache entry ignores the title used for the fallback search | A barcode-only miss blocks every later barcode+title lookup for 24h; different titles share one fallback answer |
| 3 | The caller identity used for the daily cap trusts a client-supplied forwarding header | Anyone can reset their own cap per request and drain the shared daily marketplace budget for everyone |
| 4 | Numeric settings (caps, budget, fee rate, shipping, cache lifetime, threshold, port) are unvalidated | A typo such as a non-numeric cap silently **removes** the cap |
| 5 | Simultaneous identical first-time lookups each call the marketplace | Wasted quota under exactly the burst a launch produces |
| 6 | Per-caller counters are never cleaned up | Memory grows with every distinct caller for the life of the process |
| 7 | Unknown request fields are silently ignored | A misspelled field (the project's own smoke test sends `costBasis`) produces a plausible answer computed from the wrong inputs |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A title lookup's market-crowding read reflects the item, not its merchandise (Priority: P1)

A reseller searches "Chrono Trigger SNES". Spec 004 already values only the dominant product group,
but the "how many sellers are competing" figure still counts every listing the free-text search
touched, including the merchandise that was filtered out of the price. The crowding read, and any
downgrade it causes, must be based on the item's own competing supply.

**Why this priority**: It changes verdicts. A flooded-market downgrade driven by keychains is a
wrong answer delivered confidently — the exact failure class specs 003 and 004 exist to remove.

**Independent Test**: Feed a title search whose returned listings are 40% one product and 60%
merchandise, with a large reported total. The supply used for the liquidity tier is the matched
product's estimated share, not the raw total, and the verdict changes accordingly.

**Acceptance Scenarios**:

1. **Given** a title search reporting 500 total listings of which the matched group is 20% of the
   returned sample, **When** the verdict is computed, **Then** the competing-supply figure used for
   the liquidity tier is 100 (not 500).
2. **Given** a barcode lookup reporting 500 total listings, **When** the verdict is computed,
   **Then** the competing-supply figure is 500, unchanged from today.
3. **Given** any lookup, **When** the result is returned, **Then** the response carries both the
   raw marketplace total and the supply figure actually used, so the adjustment is auditable.
4. **Given** a title search where the matched group is the entire sample, **When** the verdict is
   computed, **Then** the supply figure equals the raw total.

---

### User Story 2 - The per-caller daily cap cannot be bypassed (Priority: P1)

The service owner relies on a per-caller daily lookup cap to keep aggregate usage inside the
marketplace quota. Today a caller can defeat it by sending a different forwarding header on every
request. Proxy trust must be an explicit deployment choice, off unless configured.

**Why this priority**: It is the cost and availability guard for every user. One abusive caller
can currently exhaust the shared daily budget and lock out everyone until midnight UTC.

**Independent Test**: With default configuration, send more than the daily cap of requests from
one connection, each with a different forwarding header; requests past the cap are refused.

**Acceptance Scenarios**:

1. **Given** default configuration, **When** one connection sends cap+1 lookups each with a
   distinct forwarding header, **Then** the last is refused with the limit-reached response.
2. **Given** the operator has configured a trusted proxy, **When** requests arrive through that
   proxy, **Then** callers are distinguished by the forwarded client address.
3. **Given** a trusted proxy is configured, **When** a request arrives directly from an address
   that is not a trusted proxy, **Then** its forwarding header is ignored.

---

### User Story 3 - A barcode lookup with a title fallback gets its own answer (Priority: P2)

A reseller scans a barcode eBay doesn't know. With only the barcode there is nothing to value. If
they then retry with the barcode plus a typed title, the title fallback must run — today the empty
barcode-only answer is served from cache for 24 hours instead.

**Why this priority**: It makes the documented fallback silently unreachable, and lets one user's
typed title decide another user's answer for the same barcode.

**Independent Test**: Look up an unknown barcode alone, then the same barcode with a title; the
second lookup performs the title fallback and returns its result.

**Acceptance Scenarios**:

1. **Given** barcode B returned no listings to a barcode-only lookup, **When** B is looked up with
   title T, **Then** the title fallback runs and its result is returned — without re-querying the
   barcode, which is already known to be empty.
2. **Given** B+T1 was answered via title fallback, **When** B+T2 is looked up, **Then** it is
   answered from a T2 search, not the cached T1 answer.
3. **Given** barcode B has listings, **When** B is looked up with any title or none, **Then** all
   share one cached barcode answer (the title is irrelevant when the barcode matches).
4. **Given** B+T was answered via title fallback, **When** B is looked up alone, **Then** the
   answer is the empty barcode result, not T's fallback.

---

### User Story 4 - Burst traffic costs one marketplace call per product (Priority: P2)

When several users look up the same uncached product at the same moment — a shared link, a popular
item at a launch — only one marketplace search runs and every caller receives its result.

**Why this priority**: Direct quota and cost saving under the traffic pattern a launch creates.

**Independent Test**: Fire 10 simultaneous lookups for one uncached product against a counting
fake marketplace; exactly one search is made and all 10 receive the same valuation.

**Acceptance Scenarios**:

1. **Given** 10 concurrent identical cold lookups, **When** they complete, **Then** one
   marketplace search was made and each caller's per-caller cap was still charged once.
2. **Given** the shared search fails, **When** it fails, **Then** every waiting caller receives the
   temporarily-unavailable response and a later lookup can retry (the failure is not cached).
3. **Given** concurrent callers with different cost bases or thresholds, **When** they share one
   valuation, **Then** each receives a verdict computed from their own inputs.

---

### User Story 5 - Misconfiguration and malformed requests fail safe and loud (Priority: P3)

An operator mistyping a setting gets a warning and a sane default, never a silently disabled guard.
A client sending a misspelled field gets an immediate validation error, never a plausible answer
computed without its input. Long-running processes don't accumulate per-caller memory.

**Why this priority**: None of these change answers under correct use, but each turns an easy
mistake into a silent failure.

**Independent Test**: Start with a non-numeric daily cap → a warning is logged and the default cap
applies. Send `{"title":"x","costBasis":0}` → validation error naming the unknown field.

**Acceptance Scenarios**:

1. **Given** any numeric setting is non-numeric, negative, or out of its valid range, **When** the
   service starts, **Then** it logs a warning naming the setting and uses that setting's default.
2. **Given** a lookup body with a field outside the documented set, **When** submitted, **Then**
   the response is a validation error and no marketplace call is made.
3. **Given** callers from previous UTC days, **When** a new day's traffic arrives, **Then** their
   stale counters are released and memory does not grow with the all-time count of distinct callers.
4. **Given** the project's documented smoke-test command, **When** run, **Then** it uses only valid
   field names.

### Edge Cases

- Title search with zero priced listings: the supply figure is 0 and the verdict is the existing
  no-market-data answer (liquidity tier UNPROVEN).
- Scaled supply that rounds to 0 while the matched group has listings: the supply figure is at
  least the matched group's own listing count, never below the listings we actually saw.
- Raw total smaller than the returned sample (marketplace inconsistency): the supply figure is
  never less than the matched listings observed.
- Barcode+title where the barcode is cached as having listings: the title is ignored, no search.
- A coalesced search in flight when the cache entry is also written by another path: the stored
  result is the same valuation either way; no double-charge of the daily marketplace budget.
- Trusted-proxy setting present but empty or malformed: treated as "no proxy trusted", with a
  warning.
- An explicit `null` for an optional field: rejected the same as a wrong type (existing behaviour).
- Fee rate of exactly 0 or 1, cache lifetime of 0: see FR-010 ranges.

## Requirements *(mandatory)*

### Functional Requirements

**Liquidity supply (US1)**

- **FR-001**: For title-sourced valuations (including barcode lookups that fell back to title), the
  competing-supply figure used for the liquidity tier MUST be the raw marketplace total scaled by
  the matched group's dominance share, rounded to a whole listing.
- **FR-002**: The supply figure MUST NOT be lower than the number of matched listings observed.
- **FR-003**: Barcode-sourced valuations MUST use the raw total unchanged.
- **FR-004**: Every response MUST carry both the raw marketplace total and the supply figure used
  for the liquidity tier. Existing response fields keep their names and meaning; the supply-derived
  liquidity score and reason text use the adjusted figure.
- **FR-005**: No additional marketplace calls may be made to compute the supply figure.

**Caller identity (US2)**

- **FR-006**: By default, the caller identity for per-caller caps MUST be the directly connected
  network address; forwarding headers MUST be ignored.
- **FR-007**: The operator MUST be able to declare trusted proxies explicitly (by address/range or
  hop count). Only then are forwarding headers honoured, and only from those proxies.

**Cache correctness (US3)**

- **FR-008**: A barcode lookup's cached answer MUST depend on the title only when the barcode search
  returned no listings; barcode-matched answers are shared regardless of title.
- **FR-009**: A barcode known (from cache) to return no listings MUST NOT be re-searched while that
  knowledge is fresh; a subsequent barcode+title lookup performs only the title search.

**Configuration (US5)**

- **FR-010**: Each numeric setting MUST be validated at startup and fall back to its default with a
  logged warning when invalid. Valid ranges: daily lookup cap and daily marketplace budget are
  integers ≥ 1; fee rate in [0, 1); flat shipping is an integer ≥ 0 cents; cache lifetime > 0 hours;
  default profit threshold ≥ 0 dollars; port is an integer 1–65535.

**Burst coalescing (US4)**

- **FR-011**: Concurrent lookups that miss the cache for the same key MUST share one in-flight
  valuation; only the first counts against the daily marketplace budget.
- **FR-012**: A failed shared valuation MUST be delivered as a failure to every waiter and MUST NOT
  be cached or remembered once all waiters are notified.
- **FR-013**: Per-caller charges and per-request inputs (cost basis, threshold) remain per caller.

**Memory bound (US5)**

- **FR-014**: Per-caller counters from previous UTC days MUST be released without requiring that
  caller to return, with O(1) work on the lookup path.

**Request strictness (US5)**

- **FR-015**: The lookup request MUST reject any field outside `identifier`, `title`,
  `costBasisCents`, `profitThresholdCents` with a validation error naming the offending field.
- **FR-016**: The project's documented smoke-test commands MUST use valid field names.

### Key Entities

- **Valuation** (cached, shared): gains the supply figure used for liquidity and keeps the raw
  marketplace total. Keyed by barcode, by barcode+title for fallbacks, or by title.
- **Caller identity**: the address a per-caller cap is charged to; derived from the connection
  unless a trusted proxy vouches for a forwarded address.
- **Service settings**: validated numeric knobs, each with a documented default and valid range.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a title search where merchandise makes up most of the result set, the item's
  liquidity tier is computed from its own supply — verified by a fixture where the verdict moves
  from a flooded-market downgrade to the correct profitable verdict.
- **SC-002**: With default settings, a single client cannot complete more than the configured daily
  cap of lookups, regardless of headers sent (0 bypasses in an adversarial test).
- **SC-003**: 10 simultaneous identical uncached lookups consume exactly 1 marketplace call.
- **SC-004**: A barcode+title lookup after a barcode-only miss returns a title-fallback valuation
  100% of the time, using exactly one marketplace call.
- **SC-005**: Every numeric setting, when given a garbage value, produces a startup warning and a
  working guard — 0 settings where bad input disables a limit.
- **SC-006**: Lookup latency for cache hits is unchanged (no measurable regression) and no step
  adds a marketplace call.
- **SC-007**: After a simulated UTC day rollover with 10,000 distinct prior-day callers, retained
  per-caller entries are bounded by the current day's callers.

## Assumptions

- **Dominance scaling is an estimate, and is labelled as such by carrying both figures.** The
  dominance share is measured on the returned sample (≤ 50 listings, relevance-ordered) and
  extrapolated to the full total; it is directionally right and costs nothing, which is the bar the
  supply-side liquidity signal already holds itself to (`SUPPLY_SIDE_ONLY`).
- **Proxy trust defaults to off.** No proxy exists in any current deployment; the first deployment
  that adds one sets the trusted-proxy setting as part of that change.
- **In-memory coalescing is sufficient.** The API is a single stateless process for MVP; cross-
  process coalescing arrives, if ever, with shared caching.
- **Barcode-only empty results remain cached** (spec 001 decision: saves quota); this spec only stops
  that entry from hiding the title fallback.
- **Rejecting unknown fields is a breaking change for any client sending extras.** No client exists
  yet, which is exactly why it is made now.
- Out of scope: variant/region separation, frontend, persistence, authentication, condition.
