# Plan: W1-06 — case overview, nine-slot pack editor and version navigation

2026-09-22. Ticket W1-06 (issue #22), branch `codex/w1-06-case-pack-versions`, worktree `/Users/tkhongsap/github/rai-wt/W1-06`. Lane B, Agent-eligible. Recorded before code (AGENTS.md). No Postgres: Lane B builds against the W1-13 substitute (W0-02 section 8.1: substitute runs are never acceptance evidence; A02 is realised when W1-INT runs the same spec against the real server).

## Intent

One flow in the SPA for the case the owner or BU SPOC opens: the case overview (identity, submission version, status as text plus colour, next action, the W0-04 fields), the nine-slot pack editor over W0-02 section 7.5 (every slot state and reason reachable, the N/A reason mandatory, upload through 7.4, save with `expectedVersion`, submit through 7.6) and version navigation over 7.6 (the submitted versions the API serves, each frozen and read-only, deep-linkable). Every user-facing string comes from the locale catalogue (D12, section 10). No client-side check decides access: the screen renders what the API returns and shows the W0-06 envelope's `messageKey` when it refuses (401 → the sign-in route with `returnTo`; 403 / 404 → an error state).

## Spec (owning documents, read in full)

W0-02 plan sections 1 (layout: `web/src/api/`, `web/src/screens/`, `tests/browser/`), 1.1 (Product UI row; "the SPA never decides access; it only hides what the API refuses"), 3.4-3.6, 7.1-7.6 (the shapes, verbatim), 8.1 (browser layer: interacts only through the UI), 9 (UI quality bar, items 1-9), 10 (language rule, items 1-8); W0-06 8.2 envelope (`stale_version` details: `guidanceKey`, `current`, `refreshPath`); W0-05 section 6 (the substitute is the stand-in server; the SPA is never authority); the design handoff (tokens, "documents as rows", "status always text plus colour", "case identity, submission version and next action prominent") and `demo/reference/Main.dc.html` (layout and copy only; none of its client-side permissions); decisions D11 (stage context stored, never a lifecycle state) and D12; the W1-13 README (serve.ts on loopback behind the Vite proxy; `reset()`).

## Files

- `rai-web/web/src/api/client.ts` — the only place `fetch` is called (section 1): `request()` with `credentials: 'same-origin'`, `Accept: application/json`, the `Idempotency-Key` header when given, and the W0-06 envelope parsed into `ApiError { status, code, messageKey, correlationId, details }`; never a permission rule.
- `rai-web/web/src/api/case.ts` — the 7.2-7.6 calls this flow needs: `getSession`, `getCase`, `getConfiguration`, `getDraft`, `saveDraft`, `uploadArtifact` (multipart, one `file` part), `getArtifactMeta`, `listVersions`, `getVersion`, `submitDraft` (UUID idempotency key per user action).
- `rai-web/web/src/screens/case/` (the W1-06 module):
  - `locale.tsx` — a minimal locale context over `@rai/shared/locales/keys` `t()` (`useT()`, `useLocale()`); the session's `locale` sets `<html lang>` and the document title. **Interim**: W1-07 owns `web/src/i18n/`; this shim is swapped for the W1-07 provider when this branch rebases onto it (the task brief: "do not both create web/src/i18n").
  - `view-model.ts` — pure functions with unit tests: slot catalogue (nine slots, names as locale keys, lanes from `LANE_MAPPING_V1` / `lanesForSlot`), `nextActionKey(case)`, `slotStatusKey`, `reasonText`, `formatDateTime` (Asia/Bangkok, `th-TH-u-ca-gregory` / `en-GB`), `applySlotChange` (pending changes → `PackDraftUpdateRequest.slots`), `naReasonValid` (trimmed, 1..500), `describeError` (envelope → message and guidance keys).
  - `case-screen.tsx` — the flow: loads session, case, configuration, draft (when `draft` is not null), versions and artifact metadata; routes `/cases/:caseId` (draft or latest version) and `/cases/:caseId/versions/:versionId`; renders overview + version navigation + editor or frozen version; error states from the envelope.
  - `case-overview.tsx`, `version-nav.tsx`, `pack-editor.tsx`, `pack-frozen.tsx`, `slot-dialog.tsx` (native `<dialog>` + `showModal()`: focus moves in, returns to the invoking control, Escape closes unless the reason field holds unsaved input, in which case it asks inline), `status-badge.tsx` (`[data-status]` with visible text; cannot render without a label).
  - `case.css` — handoff tokens as custom properties scoped to the screen, Thai-capable font stack, line-height ≥ 1.6, focus ring 2 px `#00639F` on `:focus-visible` only, three widths.
  - `view-model.test.ts`, `no-literals.test.ts` (scans the `.tsx` files of this directory with the TypeScript compiler API: no JSX text outside the punctuation allow-list, no string literal in `title`, `aria-label`, `aria-description`, `placeholder`, `alt`).
  - `routes.tsx` / `index.ts` — the route elements W1-07's router mounts.
- `rai-web/web/src/app.tsx` — interim router mounting the case routes and a `/sign-in` placeholder that renders `auth.session_required`; W1-07 replaces the file with the shell and router (this branch rebases onto W1-07 before merge if W1-07 lands first).
- `rai-web/web/vite.config.ts` — the proxy target and dev port read from `API_PROXY_TARGET` / `SUBSTITUTE_WEB_PORT` (process.env is allowed here, section 1.1) so the substitute run does not collide with `npm run dev`.
- `rai-web/shared/src/locales/th.json`, `en.json` — the W1-06 keys (`case.*`, `pack.*`, `slot.*`, `version.*`, `stage.*`, `model_type.*`, `lane.*`, `action.*`), Thai default.
- `rai-web/eslint.config.js` — `react/jsx-no-literals` narrowed to what section 10.2 says: JSX text (with the punctuation and numeral allow-list) and string literals in `title`, `aria-label`, `aria-description`, `placeholder`, `alt` (a `no-restricted-syntax` selector, since the plugin cannot name attributes). As configured by W1-00 the rule flagged every attribute string (`type="button"`, `className`, `href`), which no JSX can satisfy; the section 10 text is the rule.
- `rai-web/tests/browser/playwright.substitute.config.ts` + `tests/browser/support/substitute-server.ts` — the second Playwright configuration the plan asks for: starts the W1-13 substitute on loopback (`NODE_ENV=test`, port 8789) with a `POST /__substitute/reset` hook for per-test isolation, and the Vite dev server (port 5175, `VITE_API_SUBSTITUTE=true`, proxy to 8789); the same three width projects. `playwright.config.ts` ignores `*.substitute.spec.ts`; `npm run test:browser:substitute` runs the new configuration.
- `rai-web/tests/browser/w1-06-case-pack-versions.substitute.spec.ts` — every Done-when clause through the UI only (roles, labels, keyboard): each slot state and reason reachable by keyboard; N/A reason cannot be skipped (Apply with an empty reason keeps the dialog open with the `validation.reason_required` message; the API's own 422 is also rendered); save with `expectedVersion` (409 `stale_version` shown with guidance and refresh when another session saved); submit → version navigation shows the versions `GET /api/cases/{id}/versions` serves; a frozen version is read-only; dialog focus containment (four behaviours); Tab order with visible focus; `[data-status]` text; axe zero critical/serious on every state, `lang="th"` and once `lang="en"`; no horizontal scroll at 390; Thai fixture name renders; forbidden (`fx-user-owner-cm-2`) and unauthenticated (sign-in route with `returnTo`) envelopes rendered without any client-side rule.
- `TESTING.md` — the new command; `changes/2026-09-22-w1-06/review.md` — commands and output.

## Order

1. Locale keys; `view-model.ts` with its tests (red → green); `no-literals.test.ts`.
2. API client, screens, CSS; lint config narrowed to the section 10 text; `app.tsx` interim router.
3. Substitute Playwright configuration and the spec; iterate until keyboard, dialog and axe assertions pass at 1440 / 834 / 390.
4. `npm run verify`, `npm run build && npm run check:substitute-absent`, `npm run test:browser` (unchanged suite), `npm run test:browser:substitute`, repository-root checks; review.md; PR (rebased onto W1-07 if it has landed).

## Not done here

The shell, sign-in screen, case list and new-case form (W1-07); the real-server wiring and the W1 journey (W1-INT); lanes, findings, history (W2); any server or substitute edit (Lane A / C: where the substitute disagrees with section 7 the PR body says so); any change to D07-D10 or the frozen source spec.
