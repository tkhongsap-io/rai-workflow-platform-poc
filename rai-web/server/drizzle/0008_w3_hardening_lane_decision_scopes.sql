-- migration: 0008_w3_hardening_lane_decision_scopes
-- ticket: W3 hardening H8
-- rewrites frozen rows: no
-- rollback expectation: additive; one nullable column and one FK, no trigger or grant change
--
-- actor_scopes: the approver's RoleScope grants at decision time, so the Ready self-approval check (W0-06 §6
-- condition 4) does not depend on grants that change later. NULL on rows written before this migration.
-- observed_qc_run_id now references qc_run(id), as W0-04 documents. The row-level append-only trigger and the
-- rai_app SELECT, INSERT grant already cover the new column.
ALTER TABLE "lane_decision" ADD COLUMN "actor_scopes" jsonb;--> statement-breakpoint
ALTER TABLE "lane_decision" ADD CONSTRAINT "lane_decision_observed_qc_run_id_qc_run_id_fk" FOREIGN KEY ("observed_qc_run_id") REFERENCES "public"."qc_run"("id") ON DELETE no action ON UPDATE no action;
