# School And Apartment Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add official school locations and school metrics to the map, and replace apartment name-only price matching with auditable official identities.

**Architecture:** Generate small static JSON files in GitHub Actions from official public data. Keep browser work read-only and synchronous after load. Preserve conservative price matching, adding reviewed multi-name identities and address fields instead of broad fuzzy matching.

**Tech Stack:** Vanilla JavaScript, Leaflet, Node.js built-ins, GitHub Actions.

**Spec:** `DESIGN.md`

## Global Constraints

- No new runtime dependency.
- School proximity means straight-line distance, not assigned attendance zone.
- Never infer missing school metrics.
- Keep existing uncommitted commute UI changes.

---

### Task 1: School Data Logic

**Files:** Create `public/school-data.js`, `scripts/school-data-lib.mjs`, `scripts/school-data.test.mjs`; modify `package.json`.

- [ ] Write failing tests for CSV parsing, national percentile, and nearest three schools per level.
- [ ] Run `node --test scripts/school-data.test.mjs` and confirm failure.
- [ ] Implement the minimum helpers.
- [ ] Re-run the test and confirm pass.

### Task 2: School Data Generation

**Files:** Create `scripts/refresh-schools.mjs`, `public/data/schools.json`; modify `.github/workflows/refresh-schools.yml`, `scripts/check-data.mjs`.

- [ ] Parse the official Schoolzone CP949 CSV and optional Schoolinfo metrics.
- [ ] Generate stable school records and percentile fields.
- [ ] Validate generated coordinates, levels, and sources.

### Task 3: School UI

**Files:** Modify `public/index.html`, `public/app-main.js`, `public/app-events.js`, `public/app-actions.js`, `public/map-view.js`, `public/detail-view.js`, `public/styles.css`, `public/sw.js`, tests.

- [ ] Write failing UI contract and marker tests.
- [ ] Add persisted school toggle and viewport-bound school markers.
- [ ] Add nearest three schools per level to apartment details.
- [ ] Verify mobile and desktop interactions in a real browser.

### Task 4: Official Apartment Identities

**Files:** Modify `scripts/price-refresh-lib.mjs`, `scripts/refresh-prices.mjs`, `config/price-name-aliases.json`, `.github/workflows/refresh-prices.yml`, tests.

- [ ] Write failing tests for transaction address fields and reviewed multiple official names.
- [ ] Preserve legal-dong, lot, road address, and build year from MOLIT rows.
- [ ] Apply reviewed official-name mappings for known mismatches.
- [ ] Separate unresolved identity from a known complex with no recent trade.

### Task 5: Verification

**Files:** No production files unless repair is needed.

- [ ] Run `npm test` and `npm run check`.
- [ ] Exercise school toggle and apartment details at mobile and desktop sizes.
- [ ] Run visual QA, runtime debugging audit, and final implementation review.
