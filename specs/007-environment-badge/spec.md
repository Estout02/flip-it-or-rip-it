# Feature Specification: Environment Badge

**Feature Branch**: `007-environment-badge`

**Created**: 2026-09-26

**Status**: Draft

**Input**: User description: "Environment badge: the web client gives no sign it is showing eBay sandbox (test) data, so a real item scanned in dev comes back 'No one is selling this' and the user reasonably concludes the app is wrong. Expose the active eBay environment … and show a clear, accessible 'Test data — eBay sandbox' indicator whenever the environment is not production …"

## Background

On 2026-09-26, the founder scanned a real item in the development stack and was told "No one is
selling this on eBay right now", which was plainly false. Nothing in the app was broken. The stack
runs against eBay's **sandbox** by design (CLAUDE.md), and the sandbox holds a handful of fake test
listings, so almost every real item returns no market.

The app was being honest about its data, but it wasn't honest about *which* data. A tester, a demo
audience, or a founder who forgets which mode is running will draw the same wrong conclusion. The
fix is to say so, visibly, whenever the answers aren't real.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - I can tell at a glance that I'm looking at test data (Priority: P1)

Anyone using the app while it's connected to eBay's sandbox sees a persistent, clearly worded
indicator that results come from test data, so a surprising answer is read as "test data" rather
than "the app is wrong".

**Why this priority**: This is the whole feature. It prevents the exact misreading that happened.

**Independent Test**: With the service in sandbox mode, load the app. A "Test data — eBay sandbox"
indicator is visible on every screen size and is announced by screen readers. With the service in
production mode, the indicator is absent.

**Acceptance Scenarios**:

1. **Given** the service is in sandbox mode, **When** the app loads, **Then** a persistent
   indicator is visible in the page header at every width. It reads "Test data" at the narrowest
   widths and "Test data — eBay sandbox" where space permits (≥ 480 px). It doesn't cover content,
   and its arrival doesn't move anything below the header.
2. **Given** sandbox mode, **When** a screen-reader user reaches the top of the page, **Then** the
   indicator is announced as part of the page (not as a transient alert), including a short
   explanation that results aren't real market data.
3. **Given** production mode, **When** the app loads, **Then** no indicator and no extra text are
   shown.
4. **Given** the service's environment can't be determined (settings request fails), **When** the
   app loads, **Then** no indicator is shown and the app works normally.

---

### User Story 2 - A "not being sold" answer explains itself in test mode (Priority: P1)

When a lookup in sandbox mode finds no listings, the result says that test data is sparse and that
the same item may well be for sale on real eBay.

**Why this priority**: The no-market result is precisely where the misreading occurs, and a badge at
the top of the page is easy to overlook at the moment of surprise.

**Independent Test**: In sandbox mode, look up an item with no sandbox listings. The no-market
result carries an extra sentence explaining that sandbox data is sparse.

**Acceptance Scenarios**:

1. **Given** sandbox mode and a no-market result, **When** it's shown, **Then** it adds: "You're
   using eBay's test environment, which has very few listings. This item may well be for sale on
   real eBay."
2. **Given** production mode and a no-market result, **When** it's shown, **Then** the result is
   unchanged from today.

---

### User Story 3 - Saved results remember where they came from (Priority: P2)

A result checked in sandbox mode and later reopened from Recent (possibly after switching to
production) is still marked as test data. A real result is never mistaken for a test one, or the
reverse.

**Why this priority**: Recent outlives a restart, and without this a switch to production would
leave misleading test results looking real.

**Independent Test**: Check an item in sandbox mode, restart in production mode, and open it from
Recent. It's marked "Test data" in the list and in the full result.

**Acceptance Scenarios**:

1. **Given** a result checked in sandbox mode, **When** it's listed in Recent, **Then** its entry
   carries a "Test data" marker, both visible and in its accessible name.
2. **Given** that result reopened, **When** the full result shows, **Then** it carries the test-data
   marker regardless of the service's current mode.
3. **Given** results saved before this feature existed (no recorded origin), **When** they're shown,
   **Then** they carry no marker.

### Edge Cases

- A settings request that is slow: the indicator appears when the answer arrives, and its arrival
  doesn't shift the lookup input the user may be typing in (no layout jump in the form).
- Forced-colors / high-contrast mode: the indicator stays distinguishable (it has a border and
  text, and doesn't rely on color).
- Dark mode: the indicator meets contrast requirements in both color schemes.
- Offline after an earlier visit: the last known mode is not assumed; the indicator shows only
  once the service confirms sandbox mode.
- Browser zoom at 400% or text at 200%: the indicator wraps and remains fully readable.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The service's client settings MUST report which eBay environment it is using
  (production or sandbox).
- **FR-002**: When the reported environment is anything other than production, the client MUST show
  a persistent indicator in the header with the visible text "Test data" (extended to "Test data —
  eBay sandbox" at ≥ 480 px). Its full text for assistive technology at every width is "Test data —
  eBay sandbox. Results come from eBay's test environment, not real listings." Its appearance MUST
  NOT shift any content below the header.
- **FR-003**: When the environment is production, or unknown, the client MUST show no indicator.
- **FR-004**: In non-production mode, a no-market result MUST add the explanatory sentence from
  US2-1.
- **FR-005**: Each saved result MUST record the environment it was checked in (when known), and
  Recent entries and reopened results from a non-production environment MUST carry a "Test data"
  marker, both visibly and in the entry's accessible name.
- **FR-006**: All additions MUST meet WCAG 2.2 AA (constitution VIII): contrast in both color
  schemes, not color-alone, forced-colors legibility, reflow at 320 px, and no obscured focus.
- **FR-007**: The feature MUST add zero marketplace calls and nothing to the lookup path.

### Key Entities

- **Client settings**: gain the service's eBay environment.
- **History entry**: gains the environment the result was checked in (optional; absent on older
  entries).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In sandbox mode, the indicator is visible without scrolling on 100% of tested screen
  sizes (320, 390, 1280 px) and in both color schemes. In production mode, it appears on 0% of them.
- **SC-002**: Automated accessibility checks report 0 violations on every screen state with the
  indicator present, including forced colors.
- **SC-003**: A person shown a sandbox no-market result can correctly say why the item "isn't being
  sold" (test data, not the real market) without being told.
- **SC-004**: The initial download grows by less than 1 KB compressed, and lookup timing is
  unchanged.

## Assumptions

- "Not production" equals sandbox today. Any future non-production environment gets the same
  treatment without further design.
- The indicator isn't dismissible. It's a fact about the data, not a notification, and there's no
  reason to hide it in a test environment.
- Unknown mode shows nothing, because claiming "test data" wrongly on a production deployment would
  be worse than missing the badge in development.
- Depends on spec 006 (the web client) and its settings endpoint.
- Out of scope: switching environments from the UI, which stays a deliberate operator action per
  CLAUDE.md.
