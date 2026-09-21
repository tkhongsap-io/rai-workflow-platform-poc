# Review: W0-01 — stack and deployment-boundary ADR (D04)

2026-09-21. Ticket W0-01 (issue #6), branch `codex/w0-01-stack-adr`, worktree `/Users/tkhongsap/github/rai-wt/W0-01`. Implementer self-review; independent reviewer agents run before merge per the D03 amendment.

## What landed

- `adr/0003-stack-and-deployment-boundary.md`: written from `adr/TEMPLATE.md`. Status Accepted, deciders Ta with the planning session as tech lead, date 2026-09-21, register D04. Scores shapes A, B (two deployables), B1 (B with one process) and C against the seven W0-01 criteria with evidence per acceptance ID and lock; records B1 as decided with the exact D04 answer from the register (Node 24, Fastify serving the React + Vite build, Postgres 16 in Docker, Drizzle with forward-only explicit migrations, openid-client with fail-closed modes, content-hash blob store, node:test and Playwright, the `rai-web/*` layout, `demo/` untouched, D12 locale keys); why B1 over A (UI richness), over C (auth/data coupling, host upgrade burden) and over plain B (second deployable); the HTTP status and `code` for each of the seven W0-06 error types, which the W0 contract defers to W0-01; consequences, risks, open items (True host at D10, Entra details at W6/W8, QC worker at W4, pinned versions in W0-02) and both BUILD_PLAN stop conditions checked.
- `adr/README.md`: row 0003 linked and set to Accepted (D04, 2026-09-21); the deferral sentence updated.
- `docs/engineering/adoption.md`: "Toolchain, dependencies, CI and deployment" row moved from "Intentionally deferred" to "Selected (D04)"; the closing D03 paragraph updated.

Not edited, on purpose: `docs/product/decisions.md` (D04 already recorded there by PR #56; agents never record decisions), `docs/product/source-spec.md` (frozen), the architecture README "Path in repo" column (W0-02), the ticket row status (GitHub issue #6 tracks it), DEVLOG/CHANGELOG/board (appended by the merge step). BUILD_PLAN, PRD and README still carry pre-D04 phrasing ("D04 inside W0-01", "no stack selected"); those are status lines for the W0-09 exit review, not this ticket.

## Checks

Shell: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (node v24.21.0).

| Command | Result |
|---|---|
| `node --test tests/*.test.mjs` | 22 pass, 0 fail, 0 skipped |
| `git diff --check` | clean |
| `shasum -a 256 docs/product/source-spec.md` | `92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354`, matches docs/sources.md |
| Relative-link audit over the three touched files | 21 links, 0 broken |

No product suite exists yet (`rai-web/` arrives with W1-00), so `npm test`, lint, typecheck and Playwright do not apply to this ticket.

## Done-when check

- [x] `adr/0003-stack-and-deployment-boundary.md` exists, follows the template, compares the three contract shapes against all seven criteria with evidence.
- [x] Records the D04 answer exactly as the register states it; Status Accepted with deciders, date and channel.
- [x] Stop condition checked per option and for the chosen stack: no unrestricted network login, no external-register writes.
- [x] adr/README.md row 0003 Accepted and linked.
- [x] docs/engineering/adoption.md Toolchain row status updated.
- [x] D07-D10 untouched; frozen source spec unchanged.
