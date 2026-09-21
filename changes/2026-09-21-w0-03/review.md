# Review: W0-03 — identity adapter spec

2026-09-21. Ticket W0-03 (issue #8), branch `codex/w0-03-identity-adapter`, worktree `/Users/tkhongsap/github/rai-wt/W0-03`. Implementer self-review; the ticket is Human review required, so the tech lead's review is authoritative and the independent reviewer agents run before merge per the D03 amendment.

## What landed

- `docs/engineering/identity-adapter.md`: the W0-03 spec. Covers the five bullets of the [W0 contract](../../docs/delivery/w0-technical-contract.md#w0-03--identity-adapter-spec) in order and makes them concrete for the D04 stack:
  - **Interface** (section 2): `Principal` = subject ID, display name, email, non-empty (role, scope) pairs; scope is the BU for `bu_spoc`, an `owned_cases` rule keyed by subject for `owner` (resolved by W0-05 against the case store, with the reason a case-ID list is not used), `all_cases` for the three reviewer roles and Admin; `VerifiedLogin`, `LoginVerifier`, `RoleResolver`, `IdentityAdapter` with `resolvePrincipal` as the contract's core function; issuer-qualified `subjectId` rule (Google `sub`, Entra `oid`, fixture id), never the email.
  - **Modes** (sections 3-5): `local-google` loopback-only with a pre-listen and a post-listen check; `network` with `allow-list` or `ad` source; `production` Entra only, any Google variable a start-up refusal; `fixture` test-only and loopback-only; a sixteen-row start-up validation table (S1-S16) with reason codes and exit code 78, plus the tests that prove each row and the ticket that runs them.
  - **Sign-in surface, session and errors** (section 6): `/auth` routes, `openid-client` v6 usage with PKCE/state/nonce, Postgres-backed opaque sessions (hashed token, absolute and idle TTL, no signing secret), and the error table mapped to the ADR-0003 codes (401/403/404/422) with D12 locale keys.
  - **Test substitute** (section 7): two fixture BUs (`BU-CM`, `BU-RP`) and seven fixture users, six single-role plus `fx-dual-coe-spoc-rp` (AI/COE reviewer and BU SPOC of `BU-RP`) for the D05 no-self-approval row; one Thai-script display name; invariants tested at W1-00; fixture routes unreachable outside `fixture` mode.
  - **Secrets** (section 8): `SecretSource` interface with `env` and `file` implementations, shared with W0-04 and W0-07; placeholder literal `set-in-custody` treated as absent; no secret in any log, error, audit row or response.
  - **Configuration shape** (section 9): the `RAI_IDENTITY_*` variable list with sample placeholders for W0-02/W1-00, and the `GroupRoleMapping` shape for the AD group-to-role mapping with values left to W6 and W8 (A10).
  - Observability hooks for W0-10, the test map (ID-01 to ID-17), locale keys, a consumer cross-link table to every W0 spec and W1-W8 ticket that uses it, open items and the BUILD_PLAN stop-condition check.
- `adr/README.md`: row 0004 now links the W0-03 spec as the source of the configuration shape (text otherwise unchanged; 0004 stays reserved).

Not edited, on purpose: `docs/product/decisions.md` (no decision made; the `local-google` unmapped-account default is flagged for the lead's review, not recorded), `docs/product/source-spec.md` (frozen), `docs/architecture/README.md` "Path in repo" column and `TESTING.md` (W0-02 only), the ticket row status (issue #8 tracks it), other W0 specs being written in parallel (cross-linked by contract section anchors, not by guessed file names), DEVLOG/CHANGELOG/board (appended by the merge step).

## Checks

Shell: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (node v24.21.0).

| Command | Result |
|---|---|
| `node --test tests/*.test.mjs` | 22 pass, 0 fail, 0 skipped |
| `git diff --check` | clean |
| `shasum -a 256 docs/product/source-spec.md` | `92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354`, matches docs/sources.md |
| Relative-link and anchor audit over the two touched Markdown files | 26 links, 0 broken |

No product suite exists yet (the application skeleton arrives with W1-00), so `npm test`, lint, typecheck and Playwright do not apply; the TypeScript in the spec is notation, not compiled code. No Postgres was started for this ticket.

## Review fix round 1 (PR #62)

Finding: section 7 and test row ID-13 said the dual-role fixture is refused "approve/send-back" of its lane on a BU-RP case and attributed this to D05. D05 as recorded withholds approve only ("No one who is owner or BU SPOC on a case may approve a lane on that case"); send-back is not in the decision. Fix: both places now say "refused approve ... (D05)"; whether send-back is also withheld is listed in section 14 as a possible W0-05 refinement under D05's "review leads may refine" clause, not as D05. Checks below were rerun after the change.

## Done-when check (W0 contract, W0-03 section and exit checklist)

- [x] Interface: verified login in; subject ID, display name, email, (role, scope) pairs out; BU scope for SPOC, owned cases for owner.
- [x] Modes: `local-google` loopback only and refuses a non-loopback bind; `network` allow-list or AD; `production` True AD only, Google off; mode is configuration; misconfiguration fails closed (S1-S16, exit 78, readiness not ready).
- [x] Test substitute: six synthetic single-role users plus one dual-role identity (lane reviewer and BU SPOC of one fixture BU), a fixture user not a seventh role, usable only in the test environment.
- [x] Secrets: custody mechanism approved under D10, never configuration files; refuses to start in `network` or `production` without them.
- [x] Open: AD group-to-role mapping left to W6/W8; only the configuration shape defined.
- [x] Stack-concrete (Fastify plugin, `openid-client`, Drizzle session table, `node:test`, Playwright) with stack-neutral boundaries; cross-linked to W0-02, W0-04 to W0-08, W0-10 and the consuming W1-W8 tickets.
- [x] Stop condition: no unrestricted network login, no external-register writes, AI never approves.
- [x] D04, D05, D12 carried as written; D07-D10 untouched; frozen source spec unchanged.

## Limitations and items for the reviewer

- The `local-google` rule that an account absent from the local role map receives `owner` (least privilege, loopback only) is an agent proposal for the loopback developer mode; the lead accepts or replaces it at review (spec section 4.1 and open items).
- Route and variable names are mirrored by W0-02, which is being written in parallel; the spec states which document wins for which names, and W0-09 reconciles drift.
- Proposed repository paths follow the ADR-0003 "Proposed for W0-02" layout; W0-02 fixes them.
