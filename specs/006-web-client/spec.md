# Feature Specification: Web Client

**Feature Branch**: `006-web-client`

**Created**: 2026-09-26

**Status**: Draft

**Input**: User description: "Web client for Flip It or Rip It: a modern, mobile-first, responsive web app (with a full desktop layout) that consumes the existing lookup API … Must be ADA compliant (WCAG 2.2 AA), clean, and performant … Out of scope: accounts, saved inventory, gamification, photo/LLM identification, listing to eBay, native apps."

## Background

The valuation API (specs 001–005) is complete, but nobody can use it without a terminal. The
founder's platform decision (`docs/PROJECT_BRIEF.md`, 2026-07-07) is "whatever is best for
adoption", and a web app is explicitly acceptable. A web app is the fastest way to put the product
in front of resellers on any phone, with no install or store review, and it also serves the desktop
sellers who work from a laptop beside a pile of stock.

The product promise is **speed**: a verdict faster than opening the eBay app, searching and
eyeballing sold listings. The core loop is one screen:

> scan or type → (optional: what I paid) → verdict, reason, numbers → next item

The client also has an **honesty duty** it inherits from the API. Values are expected *sale* prices
derived from *asking* prices, liquidity is a read of competing supply rather than a record of
sales, and `UNCERTAIN` means "we couldn't identify your item", not "it's worthless". A design that
hides those caveats would present guesses as answers.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Type a barcode or title and get a verdict (Priority: P1) 🎯 MVP

A reseller at their kitchen table, phone in hand, types an ISBN from the back of a book (or "Chrono
Trigger SNES") and taps Check. Within moments they see a large, unmistakable verdict (FLIP IT,
FLIP IT (slow seller), RIP IT, or CAN'T TELL), a one-sentence reason in plain language, and the
figures behind it: estimated sale value, fees, shipping, and profit. They can also see the item the
app actually matched, to catch a mismatch. Then they clear the field and check the next item.

**Why this priority**: This is the whole product. Everything else is an accelerator. It works on
every device, with or without a camera, and it is the path assistive-technology users rely on.

**Independent Test**: On a phone-sized screen with no camera permission, enter `9780345391803` and
submit; a verdict, a reason, the money breakdown and the matched title are shown, and focus moves to
the result so that a screen reader announces the verdict.

**Acceptance Scenarios**:

1. **Given** the app is open, **When** the user enters a barcode or a title and submits, **Then** a
   loading state appears immediately, and on completion the result shows the verdict, the reason,
   estimated sale value, fees, shipping, profit, and the matched item title.
2. **Given** a result, **When** it is displayed, **Then** the verdict is conveyed by text *and* by an
   icon *and* by color (never by color alone), and the page announces it to assistive technology.
3. **Given** a `FLIP_RISKY` result, **When** it is shown, **Then** it reads as a qualified yes
   ("worth listing, expect a slow sale"), visually distinct from both FLIP and RIP.
4. **Given** an `UNCERTAIN` result, **When** it is shown, **Then** it is presented as "we couldn't
   identify this item", with the matched title prominent and a prompt to try the barcode or a more
   specific title. The figures are available but visibly de-emphasised and labelled as unreliable,
   and nothing tells the user to donate or discard.
5. **Given** a no-market-data result, **When** it is shown, **Then** it explains that no matching
   listings were found. It does not show a $0 value as if one had been measured.
6. **Given** any result, **When** it is shown, **Then** a short, always-visible note states that
   values are estimated from current asking prices, not completed sales.
7. **Given** a result, **When** the user wants to check another item, **Then** one action returns
   focus to an empty input, ready to type or scan.

---

### User Story 2 - Scan a barcode with the camera (Priority: P1)

The reseller points their phone at a barcode. The app reads it and runs the lookup with no typing,
so checking 20 books takes about as long as picking them up.

**Why this priority**: Speed is the founder's #1 requirement, and scanning is what makes 20 lookups
in the time of one manual check possible. Media (books, games, discs) is the sweet spot, and it all
carries barcodes.

**Independent Test**: On a phone with a camera, tap Scan, grant permission, show a book's barcode;
the lookup runs and the verdict appears without the user touching the keyboard.

**Acceptance Scenarios**:

1. **Given** a device with a camera, **When** the user taps Scan and grants permission, **Then** a
   live viewfinder opens with a clear target area and a visible way to cancel.
2. **Given** the viewfinder is open, **When** a supported barcode (UPC-A, EAN-13/ISBN-13, EAN-8,
   UPC-E) is in view, **Then** it is read, the camera closes, the user gets feedback that works
   without sight (the value is announced, plus a vibration where supported), and the lookup runs.
3. **Given** the user denies camera permission, or the device has no camera, or the browser cannot
   read barcodes, **When** they tap Scan, **Then** they get a plain explanation and are returned to
   manual entry with focus in the input. There is never a dead end.
4. **Given** the viewfinder is open, **When** the user cancels (button, Escape key, or back
   gesture), **Then** the camera stops immediately and focus returns to the Scan button.
5. **Given** a scan, **When** the lookup completes, **Then** the scanned code is shown in the input
   so the user can verify what was read.

---

### User Story 3 - My numbers: what I paid and my threshold (Priority: P2)

A serious seller who bought an item at a thrift store enters what they paid, so the profit is real.
They also set their own minimum profit (the founder's is $10), and the app remembers it on this
device.

**Why this priority**: Real profit for serious sellers is a founder decision (cost basis:
optional, per item), and a personal threshold is what makes the verdict *their* verdict. It is not
needed for the decluttering default, where cost is $0 and the threshold is the default.

**Independent Test**: Set the threshold to $25 and reload; it is still $25. Enter "What I paid:
$8" for an item; the profit shown is $8 lower than with $0.

**Acceptance Scenarios**:

1. **Given** the lookup form, **When** the user expands "What I paid" (optional, collapsed by
   default), **Then** they can enter a dollar amount, which is used for this lookup only.
2. **Given** settings, **When** the user sets a minimum profit in dollars, **Then** it is used for
   every subsequent lookup and survives reload on this device.
3. **Given** the user never set a threshold, **When** they look up an item, **Then** the service
   default is used and the settings screen shows it as the default.
4. **Given** invalid money input (negative, non-numeric, more than 2 decimals), **When** they submit,
   **Then** an inline error names the field and explains the fix, and nothing is sent.

---

### User Story 4 - Recent lookups on this device (Priority: P2)

After checking a stack of items, the reseller scrolls back through what they checked (verdict, item
and profit at a glance) and taps one to see its full result again without re-querying.

**Why this priority**: Resellers work in batches, so remembering results is how they sort the pile
into keep, list and donate. It is device-local, so it doesn't conflict with the stateless API.

**Independent Test**: Check three items and reload; all three appear in Recent, newest first.
Tapping one shows its full result, and clearing history empties the list.

**Acceptance Scenarios**:

1. **Given** completed lookups, **When** the user opens Recent, **Then** each entry shows the
   verdict (text + icon), matched title or query, profit, and when it was checked, newest first.
2. **Given** an entry, **When** selected, **Then** the stored result is shown in full, marked with
   when it was checked, and no new lookup is spent.
3. **Given** history, **When** the user chooses Clear history and confirms, **Then** it is emptied.
4. **Given** more than 50 lookups, **When** a new one completes, **Then** the oldest is dropped
   (the list is capped at 50).

---

### User Story 5 - Desktop layout (Priority: P2)

A seller at a laptop sees the lookup form, the current result and their recent lookups side by side,
and can work entirely from the keyboard: type, press Enter, read, and go again.

**Why this priority**: Explicitly requested. Many sellers list from a desktop, and a stretched
phone layout wastes the screen.

**Independent Test**: At 1280 px wide, the form, the result and Recent are visible at once with no
horizontal scrolling. The full loop (enter, submit, read result, return to input, open a recent
entry) is completed with the keyboard alone.

**Acceptance Scenarios**:

1. **Given** a wide screen (≥ 1024 px), **When** the app loads, **Then** lookup and result share
   the main area and Recent is visible alongside them.
2. **Given** a phone-sized screen (320–480 px), **When** the app loads, **Then** it uses a
   single-column layout with the lookup input and Scan within thumb reach, and nothing requires
   horizontal scrolling at 320 px wide or at 400% zoom.
3. **Given** any width, **When** the user navigates by keyboard, **Then** every control is reachable
   in a logical order with a clearly visible focus indicator.

---

### User Story 6 - Clear, recoverable errors (Priority: P3)

When something goes wrong (the daily limit is reached, the marketplace is temporarily unavailable,
the input isn't a valid barcode, or the connection drops), the user is told what happened in plain
language, what (if anything) they can do, and their input is kept.

**Why this priority**: Errors are infrequent, but a confusing error at the moment of use loses the
user.

**Acceptance Scenarios**:

1. **Given** the daily lookup limit is reached, **When** the user submits, **Then** they see that
   today's free lookups are used up and when they reset (in the user's local time), and recent
   lookups remain browsable.
2. **Given** the marketplace is temporarily unavailable, **When** the user submits, **Then** they see
   a "try again in a moment" message and a Retry action, and the input is preserved.
3. **Given** the service rejects the input (e.g. a malformed barcode), **When** the error returns,
   **Then** the message is shown inline at the input and announced to assistive technology.
4. **Given** the device is offline, **When** the user submits, **Then** they are told they're
   offline, and the app shell and recent lookups still load.

### Edge Cases

- Very long matched titles wrap without overflowing and without truncating the meaningful part
  on desktop; on mobile they are clamped with a way to reveal the full text.
- Negative profit is shown with a minus sign and in words ("loses $3.20"), not by color alone.
- A barcode typed with hyphens or spaces is accepted as typed (the service normalises it).
- A user submits twice quickly: only one lookup is in flight, and the button shows its busy state.
- The result for an earlier submission arrives after a newer submission: only the newest result is
  shown.
- History storage is unavailable (private mode, blocked storage, or full): the app works fully, just
  without memory, and says so once.
- The screen reader and reduced-motion preferences: no essential information is conveyed through
  animation, and motion is removed when the user prefers reduced motion.
- Forced colors / high contrast mode: verdicts, focus and borders remain distinguishable.
- Text resized to 200%: no loss of content or function.
- The camera is left open with the tab backgrounded: the camera is released.
- The same code is scanned twice in a row: no duplicate lookup fires while one is in flight.

## Requirements *(mandatory)*

### Functional Requirements

**Lookup and result**

- **FR-001**: Users MUST be able to submit a lookup by barcode (UPC/ISBN/EAN, typed or scanned) or by
  free-text title from a single input; the client decides which by content (digits with optional
  hyphens/spaces/trailing X → barcode; otherwise title).
- **FR-002**: The result MUST show verdict, reason, estimated sale value, fees, shipping, profit
  (with the cost basis if entered), matched item title, match confidence, and competition read
  (tier plus competing-listing count), with money shown in the user's locale as US dollars.
- **FR-003**: Verdict presentation MUST use four distinct treatments: FLIP ("Flip it"), FLIP_RISKY
  ("Flip it — slow seller"), RIP ("Rip it"), and UNCERTAIN ("Can't tell"). Each combines a text
  label, an icon and a color; none relies on color alone.
- **FR-004**: UNCERTAIN MUST NOT be presented as a sell or donate recommendation. Figures are
  secondary and labelled unreliable, and the user is prompted toward a barcode or a more specific
  title.
- **FR-005**: Every result MUST carry a visible basis note stating that values are estimated from
  current asking prices and that the competition read reflects competing listings, not sales.
- **FR-006**: The fields MUST NOT display `rawAskingMedianCents` as the item's value (constitution:
  valuation honesty; contract says "not the figure to display").
- **FR-007**: Only one lookup may be in flight at a time; a stale response MUST NOT overwrite a newer
  one.

**Camera**

- **FR-008**: Scanning MUST be optional and progressive: offered only where the device and browser
  can support it, and degrading to manual entry with an explanation everywhere else.
- **FR-009**: The camera MUST stop when a code is read, the user cancels, or the page is hidden.
- **FR-010**: Scanning MUST NOT send images anywhere. Recognition happens on the device.

**Settings and history (device-local)**

- **FR-011**: A minimum-profit setting in dollars MUST persist on the device and apply to all
  lookups; a per-lookup "What I paid" amount MUST be optional and not persist.
- **FR-012**: The last 50 results MUST be stored on the device, viewable in full without a new
  lookup, and clearable after confirmation.
- **FR-013**: No personal data leaves the device except the lookup request itself (query, optional
  cost, threshold). There are no analytics or third-party trackers in this feature.

**Errors**

- **FR-014**: Each failure class (limit reached, marketplace unavailable, validation, offline,
  unexpected) MUST have its own plain-language message and recovery action, preserve the user's
  input, and be announced to assistive technology.

**Layout and accessibility**

- **FR-015**: The layout MUST be designed mobile-first from 320 px, with a multi-pane desktop layout
  at ≥ 1024 px showing lookup, result and history together.
- **FR-016**: The client MUST conform to **WCAG 2.2 Level AA**, including: text contrast ≥ 4.5:1
  (3:1 for large text and UI components/focus indicators); every function operable by keyboard with
  a visible focus indicator that is never obscured; touch targets ≥ 44×44 CSS px; reflow at 320 px /
  400% zoom; text resize to 200%; semantic landmarks, headings and form labels; status messages
  announced without moving focus except where focus moves intentionally to a new result;
  `prefers-reduced-motion` honoured; usable in forced-colors mode; and the page language declared.
- **FR-017**: Light and dark color schemes MUST follow the device preference, and both MUST meet
  FR-016's contrast requirements.
- **FR-018**: The app shell MUST load and render without the network after the first visit, with
  lookups clearly unavailable while offline. The app MUST be installable to the home screen.

**Performance**

- **FR-019**: The initial page MUST be usable quickly on a mid-range phone on a 4G connection (see
  SC-002), and the scanning capability MUST load only when the user asks to scan.

### Key Entities

- **Lookup request**: query (barcode or title), optional cost paid, threshold in effect.
- **Result**: the service's verdict response as received, plus when it was checked and the query
  that produced it.
- **History entry**: a stored result; the list is capped at 50 and lives on the device.
- **Preferences**: minimum profit (dollars, or unset → service default); device-local.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a cold app open, a user can type a barcode and read a verdict in under 10
  seconds; from the scanner, under 5 seconds per item once the camera is open (excluding network
  time beyond the service's own response).
- **SC-002**: On a mid-range phone over 4G, the lookup screen is interactive within 2.5 seconds of
  first visit and within 1 second on repeat visits. Initial download is ≤ 100 KB compressed,
  excluding the on-demand scanner.
- **SC-003**: Automated accessibility audits report **0 violations** on every screen state (empty,
  loading, each of the 4 verdicts, no-market-data, each error, settings, history, scanner
  fallback), in both color schemes. A manual keyboard-only and screen-reader walkthrough of the core
  loop completes without assistance.
- **SC-004**: 100% of verdict states are distinguishable in grayscale and in forced-colors mode.
- **SC-005**: No horizontal scrolling at any width from 320 px to 1920 px, or at 400% zoom on a
  1280 px screen.
- **SC-006**: In a hallway test, 9 of 10 first-time users correctly explain what "Can't tell" means
  (i.e., not "it's worthless") after seeing it once.
- **SC-007**: Lab performance audits score ≥ 90 for performance and 100 for accessibility on mobile
  emulation.

## Assumptions

- **Web app, not native**, per the founder's "best for adoption" decision; installable to the home
  screen. Native apps remain possible later on the same API.
- **The client is served from the same origin as the API**, so no cross-origin configuration is
  exposed. This is a hosting assumption for the plan to confirm.
- **Barcode scanning in the browser** works natively on some platforms and needs an on-device
  decoder on others (notably iPhone Safari). The decoder is loaded only when the user taps Scan, so
  it never costs the typing path. If neither is available, manual entry is the path (FR-008).
- **No accounts**: history and settings are per device. Clearing site data clears them. This is
  accepted for MVP, and saved inventory is a later, server-side feature.
- **English (US) only**, US-dollar marketplace (`EBAY_US`), matching the API.
- **The per-client daily cap is shared by everyone behind one network address** (spec 005). The
  limit message therefore talks about "today's lookups", not about the individual user.
- **Brand**: there is no existing visual identity. The design direction (clean, modern, calm, with
  the verdict as the hero) is set in the plan and is not a constraint from elsewhere.
- **Depends on spec 005**, for strict request fields and the `competingSupplyCount` field used in
  the competition read.
- Out of scope: accounts, saved inventory, gamification, photo/LLM identification, eBay listing,
  native apps, internationalisation, push notifications, analytics.
