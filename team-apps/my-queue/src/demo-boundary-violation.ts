// Guardrail demo: this import crosses the team-apps → apps/** boundary and
// must fail `pnpm lint` with the no-restricted-imports boundary error.
import { refundRequests } from "../../apps/refunds-dashboard/src/db/schema";

export const violatesBoundary = refundRequests;
