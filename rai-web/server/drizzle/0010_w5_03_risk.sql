-- migration: 0010_w5_03_risk
-- ticket: W5-03 (W5 plan section 5)
-- rewrites frozen rows: no (adding a column with a constant default fires no UPDATE trigger)
-- rollback expectation: restore-required; one column, one CHECK replaced, one new table with its trigger and grant (W0-04 class; W5 plan section 9)
--
-- Why restore-required: once a submit writes case.risk_tier = 'unknown', an older binary cannot serialize that value,
-- so rolling back past this migration means restoring the pre-migration backup and redeploying the previous release.
--
-- pack_version.risk_answers: the draft's questionnaire answers with attribution (W5-04 writes, validated in the
-- application). rai_pack_version_frozen compares the whole row (%ROWTYPE), so the new column is frozen at submit with
-- no trigger change. The default stays: the fixture loader and the successor-draft insert rely on it.
-- case.risk_tier gains 'unknown' (missing evidence never becomes Low); rai_case_projection_gate still admits the write
-- only under rai.workflow_write. risk_proposal: append-only, at most one 'submit' proposal per version; 'recheck' is W6's.
-- Forward-only; never edited after merge. Applied only by `npm run migrate` as rai_owner (DATABASE_MIGRATE_URL).
ALTER TABLE "pack_version" ADD COLUMN "risk_answers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "case" DROP CONSTRAINT "case_risk_tier_check";--> statement-breakpoint
ALTER TABLE "case" ADD CONSTRAINT "case_risk_tier_check" CHECK ("case"."risk_tier" IS NULL OR "case"."risk_tier" IN ('high', 'medium', 'low', 'unknown'));--> statement-breakpoint

CREATE TABLE "risk_proposal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"unavailable_reason" text,
	"tier" text,
	"lowest_tier" text,
	"highest_tier" text,
	"rubric_revision_id" uuid,
	"rubric_label" text,
	"engine_version" text NOT NULL,
	"inputs_hash" text,
	"explanation" jsonb,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "risk_proposal_trigger_check" CHECK ("risk_proposal"."trigger" IN ('submit', 'recheck')),
	CONSTRAINT "risk_proposal_status_check" CHECK ("risk_proposal"."status" IN ('proposed', 'unavailable')),
	CONSTRAINT "risk_proposal_unavailable_reason_check" CHECK ("risk_proposal"."unavailable_reason" IN ('not_configured', 'rubric_invalid', 'engine_error')),
	CONSTRAINT "risk_proposal_tier_check" CHECK ("risk_proposal"."tier" IN ('high', 'medium', 'low', 'unknown')),
	CONSTRAINT "risk_proposal_lowest_tier_check" CHECK ("risk_proposal"."lowest_tier" IN ('high', 'medium', 'low')),
	CONSTRAINT "risk_proposal_highest_tier_check" CHECK ("risk_proposal"."highest_tier" IN ('high', 'medium', 'low')),
	CONSTRAINT "risk_proposal_status_consistency_check" CHECK (("risk_proposal"."status" = 'proposed' AND "risk_proposal"."tier" IS NOT NULL AND "risk_proposal"."rubric_revision_id" IS NOT NULL AND "risk_proposal"."unavailable_reason" IS NULL) OR ("risk_proposal"."status" = 'unavailable' AND "risk_proposal"."tier" IS NULL AND "risk_proposal"."unavailable_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "risk_proposal" ADD CONSTRAINT "risk_proposal_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_proposal" ADD CONSTRAINT "risk_proposal_version_id_pack_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."pack_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_proposal" ADD CONSTRAINT "risk_proposal_rubric_revision_id_configuration_revision_id_fk" FOREIGN KEY ("rubric_revision_id") REFERENCES "public"."configuration_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "risk_proposal_one_submit_per_version_key" ON "risk_proposal" USING btree ("version_id") WHERE "risk_proposal"."trigger" = 'submit';--> statement-breakpoint
CREATE INDEX "risk_proposal_case_id_idx" ON "risk_proposal" USING btree ("case_id");--> statement-breakpoint

-- Append-only: no UPDATE, no DELETE for any role (W0-04 immutability; as rai_qc_run_append_only, 0006).
CREATE FUNCTION rai_risk_proposal_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rai.append_only' USING DETAIL = 'risk_proposal rows are never updated or deleted (W0-04, W5)';
END;
$$;--> statement-breakpoint
CREATE TRIGGER risk_proposal_append_only BEFORE UPDATE OR DELETE ON "risk_proposal"
  FOR EACH ROW EXECUTE FUNCTION rai_risk_proposal_append_only();--> statement-breakpoint

GRANT SELECT, INSERT ON "risk_proposal" TO rai_app;
