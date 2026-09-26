import Link from "next/link";

import { AccessRequired } from "@/components/access-required";
import { formatCents, formatTimestamp } from "@/components/format";
import { REFUND_STATUSES } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isRefundServiceError } from "@/lib/refunds/errors";
import { canReview, listRefunds, type RefundFilter, type RefundRequest } from "@/lib/refunds/service";

import { RefundActions } from "./refund-actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v === undefined || v === "" ? undefined : v;
}

export default async function RefundsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (!canReview(user)) return <AccessRequired />;

  const params = await searchParams;
  const statusParam = first(params.status) ?? "pending";
  const filter: RefundFilter = {
    status: statusParam as RefundFilter["status"],
    from: first(params.from),
    to: first(params.to),
  };

  let refunds: RefundRequest[] = [];
  let error: string | null = null;
  try {
    refunds = await listRefunds({ user, filter });
  } catch (e) {
    if (!isRefundServiceError(e)) throw e;
    error = e.message;
  }

  return (
    <>
      <h1>Refund requests</h1>
      <form className="panel filters" method="get">
        <label>
          Status
          <select name="status" defaultValue={statusParam}>
            {REFUND_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value="all">all</option>
          </select>
        </label>
        <label>
          Requested from
          <input type="date" name="from" defaultValue={filter.from ?? ""} />
        </label>
        <label>
          to
          <input type="date" name="to" defaultValue={filter.to ?? ""} />
        </label>
        <button type="submit" className="btn">
          Apply
        </button>
        <Link href="/refunds" className="reset">
          Reset
        </Link>
      </form>

      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : refunds.length === 0 ? (
        <p className="empty">No refund requests match these filters.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Requested</th>
              <th>Customer</th>
              <th className="num">Amount</th>
              <th>Customer reason</th>
              <th>Status</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {refunds.map((r) => (
              <tr key={r.id}>
                <td>{formatTimestamp(r.requestedAt)}</td>
                <td>
                  <code>{r.customerId}</code>
                </td>
                <td className="num">{formatCents(r.amountCents)}</td>
                <td>{r.reason}</td>
                <td>
                  <span className={`status status-${r.status}`}>{r.status}</span>
                </td>
                <td>
                  {r.status === "pending" ? (
                    <RefundActions id={r.id} />
                  ) : (
                    <div className="reviewed">
                      <div>
                        by <strong>{r.reviewedBy}</strong> at {formatTimestamp(r.reviewedAt)}
                      </div>
                      {r.decisionReason && <div className="muted">&ldquo;{r.decisionReason}&rdquo;</div>}
                    </div>
                  )}
                  <Link className="audit-link" href={`/audit?refundId=${r.id}`}>
                    Audit trail
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
