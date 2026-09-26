import { describe, expect, it } from "vitest";

import { escapeHtml, notesHtml, queueRowsHtml } from "../src/render";

import { makeItem } from "./helpers";

describe("XSS safety (defect #8 regression)", () => {
  it("escapes markup in escapeHtml", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });

  it("renders a hostile reason escaped, never as raw markup", () => {
    const html = queueRowsHtml([makeItem({ reason: `<script>alert("xss")</script>` })], {});

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders a hostile note body escaped, never as raw markup", () => {
    const html = notesHtml([
      { id: "n1", body: `<img src=x onerror=alert(1)>`, createdBy: "demo-reviewer", createdAt: "2026-09-26T00:00:00.000Z" },
    ]);

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes values inside the notes column of a queue row", () => {
    const html = queueRowsHtml(
      [makeItem({ id: "rf_xss", customerId: `cust<svg>` })],
      { rf_xss: [{ id: "n1", body: "<b>bold</b>", createdBy: "u", createdAt: "2026-09-26T00:00:00.000Z" }] },
    );

    expect(html).not.toContain("cust<svg>");
    expect(html).toContain("cust&lt;svg&gt;");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });
});
