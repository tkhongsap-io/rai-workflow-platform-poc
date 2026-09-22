-- migration: 0005_w2_02_lane_decision
-- ticket: W2-02
-- rewrites frozen rows: no
-- rollback expectation: additive; one new table, no change to existing tables, triggers or grants
--
-- W0-04 lane_decision: append-only one row per (version, lane). Forward-only; never edited after merge.
-- Applied only by `npm run migrate` as rai_owner (DATABASE_MIGRATE_URL).
CREATE TABLE "lane_decision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"lane" text NOT NULL,
	"decision" text NOT NULL,
	"actor_subject_id" text NOT NULL,
	"actor_role" text NOT NULL,
	"feedback" jsonb,
	"observed_qc_run_id" uuid,
	"decided_at" timestamp with time zone NOT NULL,
	"correlation_id" text NOT NULL,
	"idempotency_key_id" uuid,
	CONSTRAINT "lane_decision_lane_check" CHECK ("lane_decision"."lane" IN ('ai_coe', 'dpo', 'it_security')),
	CONSTRAINT "lane_decision_decision_check" CHECK ("lane_decision"."decision" IN ('approve', 'send_back')),
	CONSTRAINT "lane_decision_feedback_check" CHECK ("lane_decision"."decision" <> 'send_back' OR "lane_decision"."feedback" IS NOT NULL),
	CONSTRAINT "lane_decision_qc_run_check" CHECK ("lane_decision"."decision" <> 'approve' OR "lane_decision"."observed_qc_run_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "lane_decision" ADD CONSTRAINT "lane_decision_version_id_pack_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."pack_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lane_decision_version_id_lane_key" ON "lane_decision" USING btree ("version_id","lane");--> statement-breakpoint
CREATE INDEX "lane_decision_correlation_id_idx" ON "lane_decision" USING btree ("correlation_id");--> statement-breakpoint

-- Append-only: no UPDATE, no DELETE (W0-04 immutability for lane_decision).
CREATE FUNCTION rai_lane_decision_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rai.append_only' USING DETAIL = 'lane_decision rows are never updated or deleted (W0-04)';
END;
$$;--> statement-breakpoint
CREATE TRIGGER lane_decision_append_only BEFORE UPDATE OR DELETE ON "lane_decision"
  FOR EACH ROW EXECUTE FUNCTION rai_lane_decision_append_only();--> statement-breakpoint

GRANT SELECT, INSERT ON "lane_decision" TO rai_app;
