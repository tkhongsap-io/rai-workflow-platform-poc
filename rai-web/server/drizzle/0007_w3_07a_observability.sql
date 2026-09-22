-- migration: 0007_w3_07a_observability
-- ticket: W3-07a prerequisite; additive, no frozen row rewrite or historical reason backfill
-- rollback: forward repair only; operational records retained, no consumer implemented here
-- Generated schema plus reviewed guards/grants. Explicit migration only, never on startup.
CREATE TABLE "operator_job_notification" (
	"job_run_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"digest_day" date NOT NULL,
	"recipient" text NOT NULL,
	CONSTRAINT "operator_job_notification_job_run_id_notification_id_pk" PRIMARY KEY("job_run_id","notification_id"),
	CONSTRAINT "operator_job_notification_notification_id_unique" UNIQUE("notification_id")
);
--> statement-breakpoint
CREATE TABLE "operator_job_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"digest_day" date NOT NULL,
	"correlation_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"breach_count" integer,
	"error_stage" text,
	"error_code" text,
	CONSTRAINT "operator_job_kind_check" CHECK ("operator_job_run"."job" = 'sla_digest'),
	CONSTRAINT "operator_job_count_check" CHECK ("operator_job_run"."breach_count" IS NULL OR "operator_job_run"."breach_count" >= 0),
	CONSTRAINT "operator_job_time_check" CHECK ("operator_job_run"."finished_at" IS NULL OR "operator_job_run"."finished_at" >= "operator_job_run"."started_at"),
	CONSTRAINT "operator_job_state_check" CHECK (("operator_job_run"."status" = 'running' AND "operator_job_run"."finished_at" IS NULL AND "operator_job_run"."error_stage" IS NULL AND "operator_job_run"."error_code" IS NULL) OR ("operator_job_run"."status" = 'completed' AND "operator_job_run"."finished_at" IS NOT NULL AND "operator_job_run"."breach_count" IS NOT NULL AND "operator_job_run"."error_stage" IS NULL AND "operator_job_run"."error_code" IS NULL) OR ("operator_job_run"."status" = 'failed' AND "operator_job_run"."finished_at" IS NOT NULL AND "operator_job_run"."error_stage" IS NOT NULL AND "operator_job_run"."error_code" IS NOT NULL AND "operator_job_run"."error_stage" IN ('query', 'render', 'enqueue') AND "operator_job_run"."error_code" IN ('query_failed', 'render_failed', 'enqueue_failed', 'internal_error')))
);
--> statement-breakpoint
CREATE TABLE "qc_late_result" (
	"id" uuid PRIMARY KEY NOT NULL,
	"qc_run_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"lane" text,
	"status" text NOT NULL,
	"refused_finding_count" integer NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"correlation_id" text NOT NULL,
	CONSTRAINT "qc_late_result_qc_run_id_unique" UNIQUE("qc_run_id"),
	CONSTRAINT "qc_late_trigger_check" CHECK ("qc_late_result"."trigger" IN ('upload', 'submit', 'approve_attempt')),
	CONSTRAINT "qc_late_lane_check" CHECK ("qc_late_result"."lane" IS NULL OR "qc_late_result"."lane" IN ('ai_coe', 'dpo', 'it_security')),
	CONSTRAINT "qc_late_status_check" CHECK ("qc_late_result"."status" IN ('completed', 'unavailable')),
	CONSTRAINT "qc_late_count_check" CHECK ("qc_late_result"."refused_finding_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "qc_run" ADD COLUMN "unavailable_reason" text;--> statement-breakpoint
ALTER TABLE "operator_job_notification" ADD CONSTRAINT "operator_job_notification_job_run_id_operator_job_run_id_fk" FOREIGN KEY ("job_run_id") REFERENCES "public"."operator_job_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_job_notification" ADD CONSTRAINT "operator_job_notification_notification_id_notification_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_late_result" ADD CONSTRAINT "qc_late_result_version_id_pack_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."pack_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operator_digest_day_recipient_key" ON "operator_job_notification" USING btree ("digest_day","recipient");--> statement-breakpoint
CREATE INDEX "operator_job_run_started_idx" ON "operator_job_run" USING btree ("started_at","id");--> statement-breakpoint
CREATE INDEX "qc_late_recorded_idx" ON "qc_late_result" USING btree ("recorded_at","id");--> statement-breakpoint
CREATE INDEX "qc_run_status_requested_idx" ON "qc_run" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "notification_status_attempts_created_idx" ON "notification" USING btree ("status","attempts","created_at");--> statement-breakpoint
ALTER TABLE "qc_run" ADD CONSTRAINT "qc_run_unavailable_reason_check" CHECK ("qc_run"."unavailable_reason" IS NULL OR ("qc_run"."status" = 'unavailable' AND "qc_run"."unavailable_reason" IN ('timeout', 'runner_error', 'not_configured', 'artifact_unreadable')));-- W0-10: a started run may finish once; identity/provenance cannot be rewritten.
CREATE FUNCTION rai_operator_job_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'rai.operator_job_immutable'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'running' THEN RAISE EXCEPTION 'rai.operator_job_must_start'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'running' OR NEW.status NOT IN ('completed', 'failed')
     OR NEW.id <> OLD.id OR NEW.job <> OLD.job OR NEW.correlation_id <> OLD.correlation_id
     OR NEW.started_at <> OLD.started_at OR NEW.digest_day <> OLD.digest_day THEN
    RAISE EXCEPTION 'rai.operator_job_immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER operator_job_guard BEFORE INSERT OR UPDATE OR DELETE ON operator_job_run
FOR EACH ROW EXECUTE FUNCTION rai_operator_job_guard();--> statement-breakpoint

-- A link proves an actual digest outbox row belongs to this run. No ordinary event can be linked.
-- Lock the run so completion cannot race a new link. Never accept a caller-supplied UUID as proof.
CREATE FUNCTION rai_operator_job_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run operator_job_run%ROWTYPE; notice notification%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'rai.append_only'; END IF;
  SELECT * INTO run FROM operator_job_run WHERE id = NEW.job_run_id FOR UPDATE;
  SELECT * INTO notice FROM notification WHERE id = NEW.notification_id;
  IF run.id IS NULL OR notice.id IS NULL OR run.status <> 'running'
     OR notice.event <> 'sla_breach_digest' OR notice.case_id IS NOT NULL
     OR notice.version_id IS NOT NULL OR notice.lane <> '-'
     OR notice.correlation_id <> run.correlation_id
     OR NEW.digest_day <> run.digest_day OR NEW.recipient <> notice.recipient THEN
    RAISE EXCEPTION 'rai.digest_provenance_invalid';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER operator_job_link_guard BEFORE INSERT OR UPDATE OR DELETE ON operator_job_notification
FOR EACH ROW EXECUTE FUNCTION rai_operator_job_link_guard();--> statement-breakpoint

-- Durable late result only; no qc_run, finding, disposition or business audit record is invented.
CREATE FUNCTION rai_qc_late_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'rai.append_only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pack_version WHERE id = NEW.version_id AND ready_at IS NOT NULL) THEN
    RAISE EXCEPTION 'rai.qc_late_requires_ready';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER qc_late_guard BEFORE INSERT OR UPDATE OR DELETE ON qc_late_result
FOR EACH ROW EXECUTE FUNCTION rai_qc_late_guard();--> statement-breakpoint
GRANT SELECT, INSERT ON operator_job_run, operator_job_notification, qc_late_result TO rai_app;
GRANT UPDATE (status, finished_at, breach_count, error_stage, error_code) ON operator_job_run TO rai_app;
--> statement-breakpoint
-- New digest outbox rows must be linked in their enqueue transaction. Historical rows are untouched.
CREATE FUNCTION rai_digest_requires_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event = 'sla_breach_digest' AND NOT EXISTS (
    SELECT 1 FROM operator_job_notification WHERE notification_id = NEW.id
  ) THEN RAISE EXCEPTION 'rai.digest_job_link_required'; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER digest_requires_job AFTER INSERT ON notification
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION rai_digest_requires_job();
