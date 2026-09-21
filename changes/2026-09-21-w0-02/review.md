# Review: W0-02 — file-level implementation plan

2026-09-21. Ticket W0-02 (issue #7), branch `codex/w0-02-file-level-plan`, worktree `/Users/tkhongsap/github/rai-wt/W0-02`. Owner type "Human; agent may draft": this is the agent draft for the tech lead and Ta; independent reviewer agents run before merge per the D03 amendment.

## What landed

- `docs/engineering/implementation-plan-w1-w3.md` (new, 13 sections): repository layout under `rai-web/` (server, web, shared, fixtures, tests; `docker-compose.yml` at the repo root with `POSTGRES_PORT`; `demo/` untouched as reference) with a module-ownership table; toolchain pins (Node 24.21.0, `postgres:16.15-alpine`); exact commands for install, database up/down per ticket, migrate, fixtures, reset, dev, build, start, unit/integration/browser tests, lint, typecheck, `npm run verify` (lint + typecheck + test) and `verify:full`; pinned dependency versions (runtime and dev) each with a reason, taken from the npm registry on 2026-09-21 with peer ranges checked (TypeScript 5.9.3 rather than 7 because typescript-eslint's ceiling is `<6.1`; ESLint 9.39.5 rather than 10 because jsx-a11y's peer ceiling is `^9`); the environment-variable list with placeholders for the `.env.example` W1-00 creates and the fail-closed rules from W0-03; the eleven CI checks (install/lockfile drift, lint, typecheck, unit, migrate + integration, build + substitute absence, Playwright + axe, demo suite + frozen-source hash, link check, audit, whitespace); the **W1 interface shapes** in TypeScript for sign-in (W0-03), case create/edit/read/list plus configuration read (W1-02), artifact upload/download (W1-03), pack draft (W1-04), submit and version navigation (W1-05), each endpoint listing its W0-06 error cases with the ADR-0003 HTTP codes, plus empty 7.7/7.8 placeholders for the W2 and W3 contract PRs; the **test-layer map** (unit, integration against the real Postgres plus substitutes, browser journey, manual) with an A-ID-by-layer table and the fixture identity convention; the **UI quality bar** (WCAG 2.2 AA, never colour-only, native dialog focus containment, visible focus, keyboard-only, axe-core via `@axe-core/playwright` with zero critical/serious, three reflow widths) marked as a proposal for Ta; the **language rule** (locale keys from the first screen, keys not text from the API, bilingual mail Thai-first, `Asia/Bangkok` rendering with Gregorian calendar, Thai filenames/search/subjects); the PR size and branch rules restated and the slice-1 sub-ticket split (W1-01a/b, W1-03a/b, W2-02a/b, W3-03a/b) as a proposal for the lead to open at W0 exit; a ticket cross-reference and the open items carried to W0-04, W0-05, W0-06, W0-08, W0-09.
- `docs/architecture/README.md`: "Path in repo" column filled for every boundary from the plan's module-ownership table; the status line and the closing paragraph updated from "no stack selected" to "recorded in ADR-0003, paths assigned by W0-02"; the pre-assignment sentence replaced.
- `TESTING.md`: "Product build (W0-W3)" section now carries the install, database, migrate/seed/reset, run, test/lint/typecheck/verify and repository-check commands, stated as specified-not-runnable until W1-00 and W1-12 merge (no claim of runtime success; W0-09 verifies the mirror).

Not edited, on purpose: `docs/product/decisions.md` and `docs/product/source-spec.md` (frozen; hash unchanged); `docs/delivery/slice-1-work-breakdown.md` (the lead mirrors the sub-ticket split there at W0 exit); `adr/README.md` (no ADR changed); other W0 specs being written in parallel (linked by contract-row anchor, not by file); the board stream, DEVLOG and CHANGELOG (appended by the merge step, as for W0-01); no GitHub issues opened (agents never open issues). No application code, package manifest, lockfile, compose file or workflow file was created; W1-00 and W1-12 create them from this plan.

## Checks

Shell: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (node v24.21.0, npm 11.19.0).

| Command | Result |
|---|---|
| `node --test tests/*.test.mjs` | 22 pass, 0 fail, 0 skipped |
| `git diff --check` | clean |
| `shasum -a 256 docs/product/source-spec.md` | `92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354`, matches docs/sources.md |
| Relative-link and anchor audit over the three touched Markdown files (scratch script, same rule as the planned `scripts/check-links.mjs`) | 57 links, 0 broken (two anchors corrected during the audit) |
| `npm view <package> version` / `peerDependencies` for every pinned package | versions and peer ranges as recorded in section 4 |

No product suite exists yet (the skeleton arrives with W1-00), so `npm test`, lint, typecheck and Playwright do not apply to this ticket.

## Done-when check (W0 contract, W0-02 bullets)

- [x] Repository layout with app, tests, fixtures and config paths; `demo/` reference only.
- [x] Exact commands to install, run, test, lint, typecheck, migrate, reset, Playwright; single `npm run verify`.
- [x] Pinned dependency versions with a reason each.
- [x] Local configuration and secret handling; variable list and placeholders for the W1-00 sample env file; no secret in Git.
- [x] CI checks on every PR: tests, lint, link check, frozen-source hash (and the rest of section 6).
- [x] PR size and branch rules from team-and-roles; slice-1 sub-ticket list.
- [x] W1 interface shapes for sign-in, case create/edit/read/list, artifact upload/download, pack draft, version navigation, each with its W0-06 error cases; W2/W3 placeholders for the contract PRs.
- [x] Architecture README "Path in repo" column filled in the same PR.
- [x] Test-layer map with A-ID per layer and the fixture identity convention.
- [x] UI quality bar (proposed for Ta): WCAG 2.2 AA, never colour-only, dialog focus containment, visible focus, named audit (axe-core) inside the browser suite.
- [x] Language rule: locale keys from the first screen, D06 timezone, Thai in filenames (W1-03), search (W3-01), subjects (W3-03); D12 bilingual, Thai default.
- [x] TESTING.md "Product build (W0-W3)" carries the commands.
- [x] Recorded decisions (D01-D06, D11, D12, W0-04 fields) carried as written; D07-D10 untouched; the frozen source spec unchanged.

## Limitations and items for the reviewer

- The sub-ticket split (section 11.1) and the UI quality bar (section 9) are proposals; the lead and Ta confirm them at W0-09, and the lead opens the sub-ticket issues and mirrors the split in the work breakdown.
- Upload limits (W0-08), the 403-versus-404 answer (W0-05), `not_found` confirmation and the slot-5/pack-level owning-lane rule (W0-06), and the projection-status vocabulary (W0-04) are carried as marked placeholders, not chosen here.
- Technical choices inside the D04 stack that this plan makes and that a reviewer may want to weigh: TypeBox (Fastify's native type provider) for the shared schemas rather than zod; a Postgres session table behind `@fastify/cookie` rather than a session library; no i18n or date library (typed key union plus `Intl`); Chromium-only Playwright; ESLint 9 and TypeScript 5.9 rather than the newest majors, for plugin compatibility. None is a D-item.
- Board CLAIM: not appended, following the W0-01 precedent that the merge step writes the lead stream and to avoid conflicts with the parallel W0 branches; the lead may append one.

## Fix round 1 (PR #65 review findings)

Four blocking findings, all resolved in `docs/engineering/implementation-plan-w1-w3.md` and `TESTING.md`; no other file changed.

1. **`SESSION_SECRET` placeholder versus "edit nothing"** (two findings, same defect). The fail-closed rule is kept: the placeholder is accepted only under `NODE_ENV=test`. Section 3.1 and the TESTING.md install block now generate the secret at install (`sed -i.bak "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env`) and the section 5 row says "generated at install; placeholder accepted only under `NODE_ENV=test`".
2. **Fixture identity widened to development.** Reverted to the W0 contract's rule: `IDENTITY_MODE=fixture` is accepted only when `NODE_ENV=test`; `local-google` is the `.env.example` default and the development login (L11), with the local Google OAuth client steps in section 3.1. Sections 3.4, 3.5, 5, 6 and 11.1 (W1-01a) now say so consistently; whether a development run may use the fixture provider is listed in section 13 as W0-03's decision, not made here.
3. **`RiskTier` fixed the rubric labels.** Section 7.3 now declares `export type RiskTier = string` as an opaque placeholder (`riskTier` stays `null` throughout slice 1); the labels are D07's, recorded before W5, and the item is listed in section 13.

Checks rerun after the fixes (same shell): `node --test tests/*.test.mjs` 22 pass, 0 fail; `git diff --check` clean; frozen-source hash unchanged; relative-link and anchor audit over the touched Markdown files: 0 broken.
