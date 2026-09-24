# Synthetic walkthrough with Nakhun

About 45 minutes. Everything is synthetic: fixture users, fixture cases, generated documents. Nothing leaves the laptop, no real mail is sent, and nothing here counts as operator acceptance (that is W7). The point is to see whether the workflow matches how the desk should actually run, and to write down what Nakhun would change.

## Before the session (Ta or an engineer, about 10 minutes)

From a clean checkout of `main`, in `rai-web/`. The `docker-compose.yml` file is at the repository root; compose finds it from `rai-web/`.

```sh
npm ci
POSTGRES_PORT=54320 docker compose -p rai-walk up -d --wait
cp .env.example .env
# in .env: set RAI_IDENTITY_MODE=fixture (leave everything else as it is)
set -a; . ./.env; set +a
npm run migrate
npm run fixtures:load
npm run build && npm run build -w fixtures
NODE_ENV=test node server/dist/main.js
```

Open http://127.0.0.1:8787 and check that `http://127.0.0.1:8787/readyz` says `"status":"ready"`. The start page asks you to sign in; after signing in you land on **My cases**.

**If a port is taken** (another Postgres on 54320 or another server on 8787), pick free ones. In `.env`, replace every `54320`; that covers `POSTGRES_PORT` and the three `DATABASE_*_URL` lines. Also set `PORT` and `PUBLIC_BASE_URL` together (for example `PORT=8797` and `PUBLIC_BASE_URL=http://127.0.0.1:8797`); mail links use the base URL. Use the same Postgres port in the `docker compose` line, and open `http://127.0.0.1:<PORT>`.

Why `NODE_ENV=test`: fixture sign-in (the user picker) is deliberately refused in any other mode, so a test build can never be mistaken for a real one. The UI is Thai by default; the language switch is in the top bar. The language is saved per user, so switch it after signing in, not on the sign-in page.

Reset between rehearsals: stop the server, `docker compose -p rai-walk down -v`, `rm -rf .local` (this also clears the mail folder), then repeat from `docker compose … up`. `fixtures:load` regenerates the documents.

## The users you can sign in as

| Picker name | Role | What they can see and do |
|---|---|---|
| ณัฐพร ส. (Nattaporn S.) | Owner, Consumer Mobile | Owns all five fixture cases; edits drafts, submits |
| Prasit W. | Owner, Consumer Mobile | Owns nothing (shows the empty, correctly scoped view) |
| Suchada P. | BU SPOC, Consumer Mobile | Acts on the two Consumer Mobile cases (RAI-2000-0001 and -0003) on the owner's behalf |
| Kritsada T. | AI/COE reviewer | All cases; decides the AI/COE lane only |
| Pimchanok R. | DPO reviewer | All cases; decides the DPO lane only |
| Wutthichai K. | IT/Security reviewer | All cases; decides the IT/Security lane only |
| Desk Admin (fixture) | Admin | Queue, all cases and desk health, read-only; cannot approve or disposition |
| Rattanaporn C. | DPO reviewer who is also SPOC for Human Resources | Shows the no-self-approval rule |

## The script

Nakhun drives; someone takes notes. At every step ask: *is this what the desk should do? What would you change?*

Use **RAI-2000-0002 Retail Store Assistant** (the vendor case, Human Resources) as the main case. It is the one whose synthetic QC produces two findings, which step 7 needs.

1. **Sign in as the owner** (Nattaporn). Look at the list: five cases, all drafts, each with its status, next action and last update. *Question: is this the list you would want to start your day with?*
2. **Open RAI-2000-0002.** Walk the nine slots. Set one to N/A (the reason is mandatory; try saving without one). Upload a PDF into another. Then open RAI-2000-0001 to show that the DPA and SOW default to N/A only when there is no vendor; on 0002 they are attached. **Do not set slot 1 (risk screening) to N/A, Not yet or Missing** on 0001, 0002 or 0004: the scripted QC then fails closed (see the known gaps below). Replacing its file is fine.
3. **Save, then submit.** Click **บันทึกฉบับร่าง** (Save draft) first; **ส่งชุดเอกสาร** (Submit) stays disabled while there are unsaved changes. There is no confirmation dialog. The version freezes and three review lanes open together. Their SLA due dates (DPO 3 working days, the others 5) are on the **Review queue** card and in the lane-opened mail, not on the case page. Look at the version history: version 1 can no longer be edited.
4. **Sign in as the DPO** (Pimchanok). Reviewers land on My cases; click **Review queue** and open the case. Findings are shown before the decision buttons. On this case the DPO lane has none ("This lane's QC run found no defects"); the findings belong to the AI/COE lane. Send it back, naming the document and what is wrong. The page confirms "Sent back; a successor draft is open".
5. **Back as the owner.** The send-back already opened a version 2 draft. It shows **Feedback from version 1**: the lane, the slot, the deficiency and the reviewer's summary. Replace that document there. Version 1 is still readable and unchanged, and lists the DPO's decision under **Lane decisions**.
6. **Resubmit, then approve all three lanes** by signing in as each reviewer in turn. Each reviewer sees only their own lane's decision panel. A lane can be approved while findings are still open; Ready then waits for them.
7. **Disposition the findings** as **Kritsada (AI/COE)**, the lane that owns them. Waive one and mark the other N/A, each with a reason, using **each finding's own buttons**. The buttons stay on a finding after it is dispositioned, and pressing them again re-dispositions that same finding, until the case is Ready and the findings become read-only. The owner can only propose "fixed"; the owning lane confirms. The case reaches **Ready for launch** only when all three lanes approved the current version and every finding is dispositioned. *Question: is "Ready for launch" the right name? The status still reads "Ready for launch" in the Thai UI too. The queue's next action already says "การตรวจทานในระบบเสร็จสิ้น" (Desk review complete), and the case page says "การตรวจสอบของโต๊ะเสร็จสิ้น": two wordings for one state. This is desk completion, not Council or ITSM approval.*
8. **Self-approval.** First, as Nattaporn, submit **RAI-2000-0005** and **RAI-2000-0003**. Submit is enabled on an untouched draft; if you changed anything, save first. Then sign in as Rattanaporn (DPO reviewer and HR SPOC) and open **RAI-2000-0005 Recruitment Screening Assistant** (Human Resources). The decision panel is simply absent: she cannot approve a lane on a case she is SPOC for. Contrast it with the Consumer Mobile case RAI-2000-0003, where she gets the DPO panel. *Question: should the page say why? She still receives the lane-opened mail for the HR case; should she?*
9. **Desk health as Admin.** Open **สถานะระบบตรวจทาน** (desk health): readiness, failed mail and retries, QC-unavailable runs, late QC, the SLA digest and error counters. On a clean run the failure lists are empty. The error counters are never zero, because every sign-in page load counts as "sign-in required". Notifications are written as one `.txt` and `.json` pair per message in `rai-web/.local/mail/`, named by hash. From `rai-web/`, `grep -l mail.sent_back .local/mail/*.txt` finds the send-back message; open it to show Nakhun what an owner receives. Its "Reviewer feedback" line shows the reviewer's summary when one was given, otherwise each slot and deficiency. *Question: the lane-opened mail's "Recorded defects" counts the whole version, not that lane; which should it be? On RAI-2000-0002 it reads 0, because lane findings are produced when the reviewer opens the lane, after the mail has gone.* Admin sees everything but has no decision buttons.

## What Nakhun will notice that is known and not yet fixed

Say these up front so the session spends its time on the workflow, not on known gaps.

- **Some names show as IDs.** Queue cards, the owner filter and the header show names. The case header's business owner, the My cases card's owner, "submitted by" on versions, and "decided by" on lane decisions (including the feedback the owner sees) still show IDs such as `fixture:fx-user-owner-cm`. Fixing it changes an API read shape, so it waits for a contract change.
- **QC is simulated.** Findings come from scripted synthetic rules. Real document checking is W4 and is not authorized yet.
- **Findings with no owning lane** (the shared BRD in slot 5, slot 9, the whole pack, or a QC-unavailable run) have no owning lane yet (issue #35). The desk refuses to guess. The run is recorded as "QC unavailable", no finding is stored, and the reviewer sees that before deciding. The case can still reach Ready. Slot 1 itself belongs to AI/COE. But its synthetic QC script expects a slot-1 file, so setting slot 1 to N/A, Not yet or Missing on RAI-2000-0001, -0002 or -0004 makes the scripted QC fail and the run is recorded as QC unavailable. That stands in for part 4 of the brief (desk health then lists the run with "Review lane: Not recorded" and the trigger "approval attempt", because opening a lane runs lane QC under that trigger even before anyone presses Approve); that is the easiest way to show it and to fill the desk-health list. See the [decision brief](issue-35-decision-brief.md).
- **Mail is local files**, not email. Real mail waits for W7 authorization.

## Record

Write down, per step: what Nakhun expected, what he saw, and what he would change. Put the notes in `changes/<date>-nakhun-walkthrough/notes.md`. Ta uses that record, alongside D07–D10, to decide what goes into the next package.
