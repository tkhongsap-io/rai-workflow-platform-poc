# Review: W0-01 — stack and deployment-boundary ADR (D04)

2026-09-21. Ticket W0-01 (issue #6), branch `codex/w0-01-stack-adr`, worktree `/Users/tkhongsap/github/rai-wt/W0-01`. Implementer self-review; independent reviewer agents run before merge per the D03 amendment.

## What landed

- `adr/0003-stack-and-deployment-boundary.md`: written from `adr/TEMPLATE.md`. Status Accepted, deciders Ta with the planning session as tech lead, date 2026-09-21, register D04. Scores shapes A, B (two deployables), B1 (B with one process) and C against the seven W0-01 criteria with evidence per acceptance ID and lock; records B1 as decided with the D04 answer as the register states it (Node 24, Fastify serving the React + Vite build, Postgres 16 in Docker, Drizzle with forward-only migrations, openid-client, local blob store behind an interface, node:test and Playwright) plus the W0-contract details the register delegates to the ADR (explicit migration step and content-hash keying from the W0-04 rules, `demo/` untouched, D12 locale keys); the repository layout is left to W0-02, with a `rai-web/*` layout offered only as a clearly labelled "Proposed for W0-02" open item; why B1 over A (UI richness), over C (auth/data coupling, host upgrade burden) and over plain B (second deployable); the HTTP status and `code` for each of the seven W0-06 error types, which the W0 contract defers to W0-01, plus a `not_found` code for W0-06 to confirm and an open item for W0-05 on whether out-of-scope references answer 403 (implemented in W1 until decided) or 404 to hide case existence; consequences, risks, open items (True host at D10, Entra details at W6/W8, QC worker at W4, pinned versions in W0-02) and both BUILD_PLAN stop conditions checked.
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
| Relative-link audit over the four touched files (ADR, adr/README, adoption, this review) | 22 links, 0 broken |

No product suite exists yet (the application skeleton arrives with W1-00 under the layout W0-02 assigns), so `npm test`, lint, typecheck and Playwright do not apply to this ticket.

## Done-when check

- [x] `adr/0003-stack-and-deployment-boundary.md` exists, follows the template, compares the three contract shapes against all seven criteria with evidence.
- [x] Records the D04 answer as the register states it, with no agent-chosen layout attributed to Ta (layout is a W0-02 open item); Status Accepted with deciders, date and channel.
- [x] Stop condition checked per option and for the chosen stack: no unrestricted network login, no external-register writes.
- [x] adr/README.md row 0003 Accepted and linked.
- [x] docs/engineering/adoption.md Toolchain row status updated.
- [x] D07-D10 untouched; frozen source spec unchanged.
