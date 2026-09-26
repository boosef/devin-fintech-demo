"use client";

import { useActionState } from "react";

import { approveAction, denyAction, type ActionState } from "./actions";

const initial: ActionState = { status: "idle", message: "" };

export function RefundActions({ id }: { id: string }) {
  const [approveState, approve, approving] = useActionState(approveAction, initial);
  const [denyState, deny, denying] = useActionState(denyAction, initial);
  const busy = approving || denying;

  return (
    <div className="actions">
      <form action={approve} className="action-form">
        <input type="hidden" name="id" value={id} />
        <input name="note" placeholder="Note (optional)" aria-label="Approval note" maxLength={1000} />
        <button type="submit" className="btn btn-approve" disabled={busy}>
          Approve
        </button>
      </form>
      <form action={deny} className="action-form">
        <input type="hidden" name="id" value={id} />
        <input name="reason" placeholder="Reason (required)" aria-label="Denial reason" maxLength={1000} />
        <button type="submit" className="btn btn-deny" disabled={busy}>
          Deny
        </button>
      </form>
      {[approveState, denyState]
        .filter((s) => s.status === "error")
        .map((s, i) => (
          <p key={i} role="alert" className="error">
            {s.message}
          </p>
        ))}
    </div>
  );
}
