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
import { laneOpenRecipientsFromIdentities, laneReviewerSpocUnits } from './versions/open-lanes.js';
import { sendBackRecipientsFromIdentities } from './workflow/send-back-notice.js';

export interface ComposeInputs {
  config: Pick<AppConfig, 'nodeEnv' | 'log' | 'trustProxy' | 'publicBaseUrl' | 'upload'>;
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
  readiness: () => Promise<ReadinessReport>;
  now?: (() => Date) | undefined;
  /** The built SPA to serve; absent when there is no web build (API only). */
  webDistDir?: string | undefined;
}

export function composeAppDeps(inputs: ComposeInputs): AppDeps {
  const { config, db, fixtureUsers, qcRunner, mailSink } = inputs;
  // The fixture identities are the only directory in slice 1; AD resolution is W8.
  const knownIdentities = fixtureUsers ?? [];
  const subjects = createSubjectDirectory(db, { known: knownIdentities }); // one directory for cases and versions
  const ownerRecipients = (ownerSubjectId: string) =>
    sendBackRecipientsFromIdentities(knownIdentities, ownerSubjectId);
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
          notifications: { sink: mailSink, identities: knownIdentities, publicBaseUrl },
        }),
    identity: {
      adapter: inputs.adapter,
      sessionStore: createPgSessionStore(db),
      facts: createScopeFactsSource(db),
      ...(fixtureUsers === undefined ? {} : { fixtureProvider: createFixtureIdentityProvider(fixtureUsers) }),
    },
    cases: { businessUnits: inputs.businessUnits, subjects },
    artifacts: { store: inputs.store, limits: config.upload },
    // W4-04: the upload-triggered QC run, bound in app.ts with the drain, only when a runner is bound. Without one the
    // submit run records not_configured (A08), so upload runs would only stack identical outage rows.
    pack: { limits: config.upload, ...(qcRunner === undefined ? {} : { qc: { runner: qcRunner } }) },
    versions: {
      subjects, // W3-F1: the same directory names submitters and deciders on reads
      laneOpenRecipients: laneOpenRecipientsFromIdentities(knownIdentities),
      laneReviewerSpocUnits: laneReviewerSpocUnits(knownIdentities), // W3-F2
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
