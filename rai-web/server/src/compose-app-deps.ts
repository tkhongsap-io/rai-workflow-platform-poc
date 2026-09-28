// The production AppDeps. start.ts builds the server from it and the integration harness
// (tests/support/fixture-app.ts) builds its in-process app from it, so the two cannot wire routes differently.

import type { MailSink } from '@rai/shared/mail/types';
import type { QcRunner } from '@rai/shared/qc/types';
import type { ReadinessReport } from '@rai/shared/schemas/observability';
import type { AppDeps } from './app.js';
import type { BlobStore } from './artifacts/blob-store.js';
import { createScopeFactsSource } from './authz/facts.js';
import type { BusinessUnitDirectory } from './cases/business-units.js';
import { createSubjectDirectory } from './cases/subject-directory.js';
import type { AppConfig } from './config.js';
import type { Db } from './db/client.js';
import { createFixtureIdentityProvider, type FixtureIdentity } from './identity/fixture.js';
import { createPgSessionStore } from './identity/session.js';
import type { IdentityAdapter } from './identity/types.js';
import { createRecipientDirectory, type RecipientDirectory } from './notifications/directory.js';

export interface ComposeInputs {
  /** `mail` is optional: the in-process test harness has no MAIL_MODE, which the configuration store treats as a sink. */
  config: Pick<AppConfig, 'nodeEnv' | 'log' | 'trustProxy' | 'publicBaseUrl' | 'upload'> &
    Partial<Pick<AppConfig, 'mail'>>;
  db: Db;
  /** Started (start() succeeded) before composition. */
  adapter: IdentityAdapter;
  /** Fixture mode only: the sign-in table, and in slice 1 the only known subjects and mail recipients. */
  fixtureUsers?: readonly FixtureIdentity[] | undefined;
  businessUnits: BusinessUnitDirectory;
  store: BlobStore;
  /** Absent: every QC run records unavailable not_configured. */
  qcRunner?: QcRunner | undefined;
  /** Absent: no case mail and no digest. */
  mailSink?: MailSink | undefined;
  /**
   * W7-07 (W7 plan section 5.3): the live recipient directory outside fixture mode (loaded by start.ts, refreshed by
   * the sign-in hook bound here). Absent: fixed over `fixtureUsers`, the values this function derived before.
   */
  recipients?: RecipientDirectory | undefined;
  readiness: () => Promise<ReadinessReport>;
  now?: (() => Date) | undefined;
  /** The built SPA to serve; absent when there is no web build (API only). */
  webDistDir?: string | undefined;
}

export function composeAppDeps(inputs: ComposeInputs): AppDeps {
  const { config, db, fixtureUsers, qcRunner, mailSink } = inputs;
  // The fixture identities name subjects in fixture mode; W7-06 subject profiles name them otherwise.
  const knownIdentities = fixtureUsers ?? [];
  const subjects = createSubjectDirectory(db, { known: knownIdentities }); // one directory for cases and versions
  // W7-07: mail recipients come from the directory, read at each use; fixed over the fixture identities by default.
  const recipients = inputs.recipients ?? createRecipientDirectory({ fixtureUsers: knownIdentities });
  const ownerRecipients = (ownerSubjectId: string) => recipients.ownerRecipients(ownerSubjectId);
  const { publicBaseUrl } = config;
  return {
    db,
    ...(inputs.now === undefined ? {} : { now: inputs.now }),
    config,
    observability: { readiness: inputs.readiness },
    ...(mailSink === undefined
      ? {}
      : {
          digest: { publicBaseUrl },
          notifications: { sink: mailSink, identities: recipients.identities, publicBaseUrl },
        }),
    identity: {
      adapter: inputs.adapter,
      sessionStore: createPgSessionStore(db),
      facts: createScopeFactsSource(db),
      ...(fixtureUsers === undefined ? {} : { fixtureProvider: createFixtureIdentityProvider(fixtureUsers) }),
      // W7-07: each committed non-fixture sign-in refreshes the live recipient directory (the W7-06 hook).
      ...(inputs.recipients === undefined ? {} : { profiles: { recorded: inputs.recipients.recorded } }),
    },
    cases: { businessUnits: inputs.businessUnits, subjects },
    // W6-04: the Admin configuration API; MAIL_MODE feeds the synthetic-recipient publish check (W6-03).
    configuration: { subjects, ...(config.mail === undefined ? {} : { mailMode: config.mail.mode }) },
    artifacts: { store: inputs.store, limits: config.upload },
    // W4-04: the upload-triggered QC run, bound in app.ts with the drain, only when a runner is bound. Without one the
    // submit run records not_configured (A08), so upload runs would only stack identical outage rows.
    pack: {
      limits: config.upload,
      subjects, // W5-04: names the risk answerers on the draft read
      ...(qcRunner === undefined ? {} : { qc: { runner: qcRunner } }),
    },
    versions: {
      subjects, // W3-F1: the same directory names submitters and deciders on reads
      laneOpenRecipients: recipients.laneOpenRecipients,
      laneReviewerSpocUnits: recipients.laneReviewerSpocUnits, // W3-F2
      qc: qcRunner === undefined ? {} : { runner: qcRunner },
    },
    decide: { sendBackRecipientsForOwner: ownerRecipients },
    findings: {
      readyRecipientsForOwner: ownerRecipients,
      ...(qcRunner === undefined ? {} : { qc: { runner: qcRunner } }),
    },
    ...(inputs.webDistDir === undefined ? {} : { static: { root: inputs.webDistDir } }),
  };
}
