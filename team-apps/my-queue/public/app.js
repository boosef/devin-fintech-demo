/* global document, window, fetch, localStorage, alert, confirm */
import { queueRowsHtml, summaryHtml } from "./render.js";

const personaSelect = document.getElementById("persona");
personaSelect.value = localStorage.getItem("mq_persona") || "demo-reviewer";

function identityHeaders() {
  const persona = personaSelect.value;
  if (persona === "none") return {};
  return {
    "x-mock-user-id": persona,
    "x-mock-role": persona === "demo-admin" ? "admin" : "reviewer",
  };
}

async function api(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...identityHeaders() },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

function showError(message) {
  const el = document.getElementById("error");
  if (message) {
    el.textContent = message;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

async function load() {
  const { status, body } = await api("/api/queue");
  if (status !== 200) {
    showError(`Core API rejected the request (${status}): ${body.message || "unknown error"}`);
    document.getElementById("rows").innerHTML = "";
    document.getElementById("countOpen").textContent = "0";
    document.getElementById("countLate").textContent = "0";
    document.getElementById("totalAmt").textContent = "$0.00";
    return;
  }
  showError(null);
  const summary = summaryHtml(body.summary);
  document.getElementById("countOpen").textContent = summary.openCount;
  document.getElementById("countLate").textContent = summary.overdueCount;
  document.getElementById("totalAmt").textContent = summary.total;
  document.getElementById("rows").innerHTML = queueRowsHtml(body.items, body.notes || {});
  document.getElementById("lastRefresh").textContent = "refreshed " + new Date().toLocaleTimeString();
}

async function decide(id, action) {
  let payload;
  if (action === "approve") {
    payload = {};
  } else {
    const reason = window.prompt("Reason for denial (required):");
    if (reason === null) return;
    payload = { reason };
  }
  const { status, body } = await api(`/api/queue/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (status === 409) {
    alert(`Already reviewed: ${body.message || "conflict"}`);
  } else if (status !== 200) {
    alert(`Rejected by core API (${status}): ${body.message || "unknown error"}`);
  }
  await load();
}

async function saveNote(id, textarea) {
  const body = textarea.value.trim();
  if (body === "") return;
  const { status, body: result } = await api(`/api/queue/${encodeURIComponent(id)}/notes`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  if (status !== 201) {
    alert(`Could not save note (${status}): ${result.message || "unknown error"}`);
  }
  await load();
}

document.getElementById("rows").addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-id]");
  if (!row) return;
  const id = row.dataset.id;
  if (event.target.classList.contains("approve")) {
    if (confirm(`Approve ${id}?`)) decide(id, "approve");
  } else if (event.target.classList.contains("deny")) {
    decide(id, "deny");
  } else if (event.target.classList.contains("note-save")) {
    saveNote(id, row.querySelector(".note-input"));
  }
});

personaSelect.addEventListener("change", () => {
  localStorage.setItem("mq_persona", personaSelect.value);
  load();
});

load();
