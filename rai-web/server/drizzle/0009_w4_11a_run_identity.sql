-- migration: 0009_w4_11a_run_identity
-- ticket: W4-11a (W4a plan section 6)
-- rewrites frozen rows: no (adding a column with a constant default fires no UPDATE trigger)
-- rollback expectation: forward repair only; two additive columns and one CHECK, no trigger or grant change
--
-- runner_version: the bound runner's QcRunner.identity.runnerVersion (engine_id keeps the runner name). Rows written
-- before this migration read 'unrecorded'; the default is then dropped so every new insert must supply the value.
-- rules_evaluated: the rules the runner executed; 0 on an unavailable run, NULL on rows written before this migration.
-- The existing rai_app SELECT, INSERT grant on qc_run covers both columns (as in 0007).
ALTER TABLE "qc_run" ADD COLUMN "runner_version" text NOT NULL DEFAULT 'unrecorded';--> statement-breakpoint
ALTER TABLE "qc_run" ALTER COLUMN "runner_version" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "qc_run" ADD COLUMN "rules_evaluated" integer;--> statement-breakpoint
ALTER TABLE "qc_run" ADD CONSTRAINT "qc_run_rules_evaluated_check" CHECK ("qc_run"."rules_evaluated" IS NULL OR "qc_run"."rules_evaluated" >= 0);
