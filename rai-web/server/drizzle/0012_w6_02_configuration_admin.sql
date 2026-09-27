-- migration: 0012_w6_02_configuration_admin
-- ticket: W6-02 (W6 plan sections 2.3 and 3); numbered 0011 until W7-03's 0011_w7_03_migration_class merged first
-- rewrites frozen rows: no (ADD COLUMN without a default and a CHECK swap fire no UPDATE trigger; seed rows keep NULL)
-- rollback expectation: restore-required; two nullable columns, one CHECK replaced, one new mutable table with its grant (W0-04 class; W6 plan section 3)
--
-- Why restore-required: once a `desk_controls` revision is published, an older binary's kind list does not know it,
-- so rolling back past this migration means restoring the pre-migration backup and redeploying the previous release.
--
-- configuration_revision.change_note: a person's note on every publish and restore (1-500 characters); NULL on seed
-- rows. configuration_revision.restores_id: the revision K a restore copied (Q3). The kind CHECK gains desk_controls.
-- The configuration_revision_frozen trigger and the rai_app grant on configuration_revision (SELECT, INSERT) are
-- unchanged, so a published revision still cannot be updated or deleted.
-- configuration_draft: one mutable Admin working copy per kind (Q1). It is not evidence; rai_app holds DELETE on it
-- and on no other table (W0-04 roles, amended 2026-09-27); the store audits each delete (discardDraft, publishDraft).
-- Forward-only; never edited after merge. Applied only by `npm run migrate` as rai_owner (DATABASE_MIGRATE_URL).
CREATE TABLE "configuration_draft" (
	"kind" text PRIMARY KEY NOT NULL,
	"base_revision_id" uuid,
	"body" jsonb NOT NULL,
	"change_note" text,
	"draft_version" integer NOT NULL,
	"updated_by" text NOT NULL,
	"updated_role" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "configuration_draft_kind_check" CHECK ("configuration_draft"."kind" IN ('checklist_templates', 'qc_rules', 'sla', 'calendar', 'operator_recipients', 'use_case_groups', 'risk_rubric', 'group_role_mapping', 'desk_controls')),
	CONSTRAINT "configuration_draft_change_note_check" CHECK ("configuration_draft"."change_note" IS NULL OR char_length("configuration_draft"."change_note") BETWEEN 1 AND 500),
	CONSTRAINT "configuration_draft_draft_version_check" CHECK ("configuration_draft"."draft_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "configuration_revision" DROP CONSTRAINT "configuration_revision_kind_check";--> statement-breakpoint
ALTER TABLE "configuration_revision" ADD COLUMN "change_note" text;--> statement-breakpoint
ALTER TABLE "configuration_revision" ADD COLUMN "restores_id" uuid;--> statement-breakpoint
ALTER TABLE "configuration_draft" ADD CONSTRAINT "configuration_draft_base_revision_id_configuration_revision_id_fk" FOREIGN KEY ("base_revision_id") REFERENCES "public"."configuration_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_revision" ADD CONSTRAINT "configuration_revision_restores_id_configuration_revision_id_fk" FOREIGN KEY ("restores_id") REFERENCES "public"."configuration_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_revision" ADD CONSTRAINT "configuration_revision_change_note_check" CHECK ("configuration_revision"."change_note" IS NULL OR char_length("configuration_revision"."change_note") BETWEEN 1 AND 500);--> statement-breakpoint
ALTER TABLE "configuration_revision" ADD CONSTRAINT "configuration_revision_kind_check" CHECK ("configuration_revision"."kind" IN ('checklist_templates', 'qc_rules', 'sla', 'calendar', 'operator_recipients', 'use_case_groups', 'risk_rubric', 'group_role_mapping', 'desk_controls'));--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "configuration_draft" TO rai_app;
