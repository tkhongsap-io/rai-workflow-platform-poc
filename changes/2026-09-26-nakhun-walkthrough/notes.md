# Nakhun walkthrough: notes

Script: [walkthrough-script.md](../2026-09-23-w3-hardening/walkthrough-script.md), which sets up synthetic data only (fixture set `slice1-synthetic@1`) and fixture identity mode on loopback. Operator: Nakhun (D01). Ta confirmed on 2026-09-26 that the walkthrough took place; how the session was set up is not recorded beyond the script.

## Outcome

**No change requested.** Ta reported the outcome in the Claude Code session of 2026-09-26: the walkthrough was done and Nakhun asked for no changes. Per-step notes (what he expected, what he saw) were not supplied, so none are recorded here; this file does not reconstruct them.

This is a synthetic walkthrough of the desk, not operator acceptance. Operator rehearsal on permitted cases is W7 and remains unauthorized.

## The script's open questions

The script asked four questions. No answers were given, so they stay open. They are product wording and notification choices, not defects:

1. **Queue as a day-start list:** "is this the list you would want to start your day with?" (step 3).
2. **The "Ready for launch" name:** one state has two Thai wordings, the queue's "การตรวจทานในระบบเสร็จสิ้น" and the case page's "การตรวจสอบของโต๊ะเสร็จสิ้น", and the status label stays in English.
3. **A conflicted reviewer and the lane-opened mail:** should the page say why a DPO reviewer who is SPOC on a case gets no decision panel? Should she still get that case's lane-opened mail? (Hardening review section 5, item 10.)
4. **"Recorded defects" in the lane-opened mail:** it counts the whole version, not the lane (hardening review section 5, item 11).

## What changed since the script was written

W2-05 (PR #159, 2026-09-25) made a QC outage a finding that its lane must waive or mark N/A before Ready. The script's known-gaps list says so. Whether this session saw that behaviour is not recorded.
