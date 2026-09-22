-- migration: 0006_w2_05_findings_dispositions
-- ticket: W2-05
-- rewrites frozen rows: no
-- rollback expectation: additive; three new tables, no change to existing tables beyond grants pattern
--
-- W0-04 qc_run, qc_finding, disposition_event: append-only. Forward-only; never edited after merge.
-- Applied only by `npm run migrate` as rai_owner (DATABASE_MIGRATE_URL).
CREATE TABLE "qc_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"slot" smallint,
	"lane" text,
	"engine_id" text NOT NULL,
	"rule_revision" text NOT NULL,
	"status" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"correlation_id" text NOT NULL,
	CONSTRAINT "qc_run_trigger_check" CHECK ("qc_run"."trigger" IN ('upload', 'submit', 'approve_attempt')),
	CONSTRAINT "qc_run_lane_check" CHECK ("qc_run"."lane" IS NULL OR "qc_run"."lane" IN ('ai_coe', 'dpo', 'it_security')),
	CONSTRAINT "qc_run_status_check" CHECK ("qc_run"."status" IN ('completed', 'unavailable')),
	CONSTRAINT "qc_run_slot_check" CHECK ("qc_run"."slot" IS NULL OR ("qc_run"."slot" >= 1 AND "qc_run"."slot" <= 9))
);
--> statement-breakpoint
ALTER TABLE "qc_run" ADD CONSTRAINT "qc_run_version_id_pack_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."pack_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qc_run_version_id_trigger_idx" ON "qc_run" USING btree ("version_id","trigger");--> statement-breakpoint
CREATE INDEX "qc_run_correlation_id_idx" ON "qc_run" USING btree ("correlation_id");--> statement-breakpoint

CREATE TABLE "qc_finding" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"slot" smallint,
	"kind" text NOT NULL,
	"rule_id" text NOT NULL,
	"rule_revision" text NOT NULL,
	"severity" text NOT NULL,
	"owning_lane" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"metric" text,
	"denominator" numeric,
	"threshold" numeric,
	"message_key" text NOT NULL,
	"message_params" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "qc_finding_kind_check" CHECK ("qc_finding"."kind" IN ('defect', 'unavailable')),
	CONSTRAINT "qc_finding_severity_check" CHECK ("qc_finding"."severity" IN ('high', 'medium', 'low', 'info')),
	CONSTRAINT "qc_finding_owning_lane_check" CHECK ("qc_finding"."owning_lane" IN ('ai_coe', 'dpo', 'it_security')),
	CONSTRAINT "qc_finding_slot_check" CHECK ("qc_finding"."slot" IS NULL OR ("qc_finding"."slot" >= 1 AND "qc_finding"."slot" <= 9))
);
--> statement-breakpoint
ALTER TABLE "qc_finding" ADD CONSTRAINT "qc_finding_run_id_qc_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."qc_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_finding" ADD CONSTRAINT "qc_finding_version_id_pack_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."pack_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qc_finding_version_id_idx" ON "qc_finding" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "qc_finding_run_id_idx" ON "qc_finding" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "qc_finding_owning_lane_idx" ON "qc_finding" USING btree ("owning_lane");--> statement-breakpoint

CREATE TABLE "disposition_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"finding_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text,
	"evidence_ref" jsonb,
	"actor_subject_id" text NOT NULL,
	"actor_role" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"correlation_id" text NOT NULL,
	"idempotency_key_id" uuid,
	CONSTRAINT "disposition_event_kind_check" CHECK ("disposition_event"."kind" IN ('fixed_proposed', 'fixed', 'fixed_confirmed', 'waived', 'not_applicable')),
	CONSTRAINT "disposition_event_reason_check" CHECK ("disposition_event"."kind" NOT IN ('waived', 'not_applicable') OR "disposition_event"."reason" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "disposition_event" ADD CONSTRAINT "disposition_event_finding_id_qc_finding_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."qc_finding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disposition_event_finding_id_created_at_idx" ON "disposition_event" USING btree ("finding_id","created_at");--> statement-breakpoint
CREATE INDEX "disposition_event_correlation_id_idx" ON "disposition_event" USING btree ("correlation_id");--> statement-breakpoint

-- Append-only: no UPDATE, no DELETE (W0-04 immutability).
CREATE FUNCTION rai_qc_run_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rai.append_only' USING DETAIL = 'qc_run rows are never updated or deleted (W0-04)';
END;
$$;--> statement-breakpoint
CREATE TRIGGER qc_run_append_only BEFORE UPDATE OR DELETE ON "qc_run"
  FOR EACH ROW EXECUTE FUNCTION rai_qc_run_append_only();--> statement-breakpoint

CREATE FUNCTION rai_qc_finding_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rai.append_only' USING DETAIL = 'qc_finding rows are never updated or deleted (W0-04)';
END;
$$;--> statement-breakpoint
CREATE TRIGGER qc_finding_append_only BEFORE UPDATE OR DELETE ON "qc_finding"
  FOR EACH ROW EXECUTE FUNCTION rai_qc_finding_append_only();--> statement-breakpoint

CREATE FUNCTION rai_disposition_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rai.append_only' USING DETAIL = 'disposition_event rows are never updated or deleted (W0-04)';
END;
$$;--> statement-breakpoint
CREATE TRIGGER disposition_event_append_only BEFORE UPDATE OR DELETE ON "disposition_event"
  FOR EACH ROW EXECUTE FUNCTION rai_disposition_event_append_only();--> statement-breakpoint

GRANT SELECT, INSERT ON "qc_run" TO rai_app;
GRANT SELECT, INSERT ON "qc_finding" TO rai_app;
GRANT SELECT, INSERT ON "disposition_event" TO rai_app;
