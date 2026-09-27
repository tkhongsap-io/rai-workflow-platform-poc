# Plan: questionnaire UI in the pack editor (W5-07, #230)

1. Board CLAIM on `docs/board/lane-b-ui-notifications.md`; this frame.
2. RED: unit tests for the view model (`risk-questionnaire.view-model.test.ts`), the client's `getRiskRubric` (`client.test.ts`), the substitute's rubric read (`fixtures/src/substitutes/api/cases.test.ts`); browser spec `w5-07-risk-questionnaire.spec.ts`. Watch them fail.
3. GREEN: locale keys; client call; view model; banner; questionnaire component; pack editor mount and unsaved count; case screen save body; substitute route and README drift line.
4. Gate (plan section 10), one suite at a time; fix every failure.
5. Records: review.md (commands, results, deviations), DEVLOG top entry, CHANGELOG line, W0-02 section 7 dated note that the web client reads the rubric (none needed beyond this ticket's frame if the shapes are unchanged).
6. Commit, push, verify the remote head, open the PR ("Refs #230").
