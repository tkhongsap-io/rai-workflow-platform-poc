// W3-05 shapes the queue (W3-01) and the lane-open mail / breach digest (W3-03) consume.
// Due dates are computed from the version's frozen SLA and calendar revisions (W0-06 4.3 (e)); they are not stored.

import { Type, type Static } from 'typebox';
import { LaneSchema } from './review.js';

const ISO_DATE = '^\\d{4}-\\d{2}-\\d{2}$';

/** One lane's clock on one submitted version. `dueOn` is a Bangkok calendar date. */
export const LaneDueSchema = Type.Object({
  lane: LaneSchema,
  openedAt: Type.String({ minLength: 1 }), // the version's submitted_at, ISO-8601
  dueOn: Type.String({ pattern: ISO_DATE }),
});
export type LaneDue = Static<typeof LaneDueSchema>;

/** A pending lane on the current review target whose due date is strictly before the as-of Bangkok date. */
export const SlaBreachSchema = Type.Object({
  caseId: Type.String({ minLength: 1 }),
  versionId: Type.String({ minLength: 1 }),
  lane: LaneSchema,
  dueOn: Type.String({ pattern: ISO_DATE }),
});
export type SlaBreach = Static<typeof SlaBreachSchema>;
