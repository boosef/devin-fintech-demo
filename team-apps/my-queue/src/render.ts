/**
 * Pure render helpers shared by the browser UI and the vitest suite. Every
 * interpolated value passes through escapeHtml before reaching innerHTML, so
 * refund reasons, customer ids, and note bodies can never inject markup.
 * (Built to public/render.js by `pnpm build` / `pnpm dev` via tsconfig.ui.json.)
 */

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type QueueItem = {
  id: string;
  customerId: string;
  amountCents: number;
  reason: string;
  requestedAt: string;
  ageDays: number;
  overdue: boolean;
  status: string;
};

type NoteLike = { id: string; body: string; createdBy: string; createdAt: string };

export function summaryHtml(summary: { openCount: number; overdueCount: number; totalCents: number }): {
  openCount: string;
  overdueCount: string;
  total: string;
} {
  return {
    openCount: String(summary.openCount),
    overdueCount: String(summary.overdueCount),
    total: formatCents(summary.totalCents),
  };
}

export function notesHtml(notes: NoteLike[]): string {
  return notes
    .map(
      (note) =>
        `<div class="note"><span class="note-meta">${escapeHtml(note.createdBy)} · ${escapeHtml(
          note.createdAt.slice(0, 10),
        )}</span><br>${escapeHtml(note.body)}</div>`,
    )
    .join("");
}

export function queueRowsHtml(items: QueueItem[], notesById: Record<string, NoteLike[]>): string {
  return items
    .map((item) => {
      const notes = notesById[item.id] ?? [];
      const badge = item.overdue ? "badge late" : "badge";
      return `<tr class="${item.overdue ? "overdue" : ""}" data-id="${escapeHtml(item.id)}">
  <td><b>${escapeHtml(item.id)}</b></td>
  <td>${escapeHtml(item.customerId)}</td>
  <td>${escapeHtml(formatCents(item.amountCents))}</td>
  <td>${escapeHtml(item.reason)}</td>
  <td>${escapeHtml(item.requestedAt.slice(0, 10))}</td>
  <td><span class="${badge}">${escapeHtml(String(item.ageDays))}d</span></td>
  <td>
    <div class="notes">${notesHtml(notes)}</div>
    <textarea class="note-input" placeholder="Add a note…" rows="2"></textarea>
    <button class="note-save secondary">Save note</button>
  </td>
  <td>
    <button class="approve">Approve ✔</button>
    <button class="deny secondary">Deny ✖</button>
  </td>
</tr>`;
    })
    .join("");
}
