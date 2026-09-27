-- migration: 0014_w4_11b_run_extraction_identity
-- ticket: W4-11b (W4b plan sections 7 and 8)
-- rewrites frozen rows: no (adding nullable columns without a default fires no UPDATE trigger)
-- rollback expectation: additive; nine nullable columns and five CHECKs, no trigger or grant change; an older binary
-- neither reads nor writes the new columns
--
-- extractor_version, model_provider, model_id, prompt_revision and the model usage numbers: what the runner reported
-- in QcRunResult.engine (identifiers and numbers only). NULL on rows written before this migration and on runs
-- without extraction or model use. unavailable_detail: the unavailable result's detail when it is a bounded code,
-- 'unspecified' otherwise, NULL when none was given; only an unavailable run carries one.
-- The existing rai_app SELECT, INSERT grant on qc_run covers every new column (as in 0007 and 0009).
ALTER TABLE "qc_run" ADD COLUMN "extractor_version" text;--> statement-breakpoint
ALTER TABLE "qc_run" ADD COLUMN "model_provider" text;--> statement-breakpoint
ALTER TABLE "qc_run" ADD COLUMN "model_id" text;--> statement-breakpoint
ALTER TABLE "qc_run" ADD COLUMN "prompt_revision" text;--> statement-breakpoint
ALTER TABLE "qc_run" ADD COLUMN "model_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "qc_run" ADD COLUMN "model_output_tokens" integer;--> statement-breakpoint
ALTER TABLE "qc_run" ADD COLUMN "model_latency_ms" integer;--> statement-breakpoint
ALTER TABLE "qc_run" ADD COLUMN "model_cost_usd_micros" bigint;--> statement-breakpoint
ALTER TABLE "qc_run" ADD COLUMN "unavailable_detail" text;--> statement-breakpoint
ALTER TABLE "qc_run" ADD CONSTRAINT "qc_run_model_input_tokens_check" CHECK ("qc_run"."model_input_tokens" IS NULL OR "qc_run"."model_input_tokens" >= 0);--> statement-breakpoint
ALTER TABLE "qc_run" ADD CONSTRAINT "qc_run_model_output_tokens_check" CHECK ("qc_run"."model_output_tokens" IS NULL OR "qc_run"."model_output_tokens" >= 0);--> statement-breakpoint
ALTER TABLE "qc_run" ADD CONSTRAINT "qc_run_model_latency_ms_check" CHECK ("qc_run"."model_latency_ms" IS NULL OR "qc_run"."model_latency_ms" >= 0);--> statement-breakpoint
ALTER TABLE "qc_run" ADD CONSTRAINT "qc_run_model_cost_usd_micros_check" CHECK ("qc_run"."model_cost_usd_micros" IS NULL OR "qc_run"."model_cost_usd_micros" >= 0);--> statement-breakpoint
ALTER TABLE "qc_run" ADD CONSTRAINT "qc_run_unavailable_detail_check" CHECK ("qc_run"."unavailable_detail" IS NULL OR ("qc_run"."status" = 'unavailable' AND "qc_run"."unavailable_detail" ~ '^[a-z0-9_]{1,64}$'));
