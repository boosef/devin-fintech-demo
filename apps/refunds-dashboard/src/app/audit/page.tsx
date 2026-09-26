import Link from "next/link";

import { AccessRequired } from "@/components/access-required";
import { formatTimestamp } from "@/components/format";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canReview, listAuditTrail } from "@/lib/refunds/service";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (!canReview(user)) return <AccessRequired />;

  const raw = (await searchParams).refundId;
  const refundId = (Array.isArray(raw) ? raw[0] : raw)?.trim() || undefined;
  const records = await listAuditTrail({ user, refundId });

  return (
    <>
      <h1>Audit trail</h1>
      <form className="panel filters" method="get">
        <label className="grow">
          Refund request id
          <input name="refundId" defaultValue={refundId ?? ""} placeholder="e.g. 3f2c…" />
        </label>
        <button type="submit" className="btn">
          Filter
        </button>
        <Link href="/audit" className="reset">
          Clear
        </Link>
      </form>
      {records.length === 0 ? (
        <p className="empty">No audit records{refundId ? " for this refund request" : ""}.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Refund request</th>
              <th>Before</th>
              <th>After</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td>{formatTimestamp(r.timestamp)}</td>
                <td>
                  {r.actor} <span className="muted">({r.actorType})</span>
                </td>
                <td>
                  <code>{r.action}</code>
                </td>
                <td>
                  <Link href={`/audit?refundId=${r.entityId}`}>
                    <code>{r.entityId}</code>
                  </Link>
                </td>
                <td>
                  <pre>{JSON.stringify(r.before, null, 2)}</pre>
                </td>
                <td>
                  <pre>{JSON.stringify(r.after, null, 2)}</pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
