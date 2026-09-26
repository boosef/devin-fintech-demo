// Fixture for tests/team-apps-boundary.test.ts: it is linted as if it lived at
// team-apps/<name>/index.mjs, where importing from apps/** must fail the
// boundary rule. It is never imported for real, and at this real path the
// team-apps scope does not apply to it.
import { refundRequests } from "../../apps/refunds-dashboard/src/db/schema";

export const forbiddenTable = refundRequests;
