import {
  shorten,
  formatTimestamp,
  getQueryParam,
  initRelayControls,
  setRelayCount,
  setDefaultRelays
} from "./app.js";
import { loadData } from "./data.js";
import { initSigner, publishEndorsement } from "./signer.js";

const titleEl = document.getElementById("ncc-title");
const subtitleEl = document.getElementById("ncc-subtitle");
const summaryEl = document.getElementById("ncc-summary");
const contentEl = document.getElementById("ncc-content");
const stewardEl = document.getElementById("ncc-steward");
const publishedEl = document.getElementById("ncc-published");
const endorsementsEl = document.getElementById("ncc-endorsements");
const proposalsEl = document.getElementById("ncc-proposals");
const nsrEl = document.getElementById("ncc-nsr");

function renderEmpty() {
  contentEl.textContent = "NCC not found on connected relays.";
}

function renderNSR(records) {
  if (!records || records.length === 0) {
    nsrEl.innerHTML = `<div class="empty">No succession records yet.</div>`;
    return;
  }

  nsrEl.innerHTML = records
    .map((record, index) => {
      const steward = record.steward ? shorten(record.steward) : "Unknown";
      const created = formatTimestamp(record.created_at);
      const reason = record.reason || "No reason provided.";
      return `
        <article class="card list-item" style="animation-delay: ${index * 50}ms">
          <strong>Steward: ${steward}</strong>
          <div class="meta">
            <span>Created: ${created || "unknown"}</span>
            <span>Authoritative: ${shorten(record.authoritative || "")}</span>
          </div>
          <p class="muted">${reason}</p>
        </article>
      `;
    })
    .join("");
}

async function load() {
  const dTag = getQueryParam("d");
  const eventId = getQueryParam("event");
  if (!dTag) return renderEmpty();

  try {
    const { data, relays, default_relays } = await loadData();
    const details = data.details(dTag, eventId);
    if (!details) return renderEmpty();
    setDefaultRelays(default_relays);
    setRelayCount(relays.length);

    titleEl.textContent = `${details.d.toUpperCase()} · ${details.title}`;
    subtitleEl.textContent = `Event: ${shorten(details.event_id)} · Pubkey: ${shorten(details.pubkey)}`;
    summaryEl.textContent = details.summary || "No summary provided.";
    if (details.content_html) {
      contentEl.innerHTML = details.content_html;
    } else {
      contentEl.textContent = details.content || "No document content available.";
    }
    stewardEl.textContent = details.steward ? shorten(details.steward) : "Unknown";
    publishedEl.textContent = formatTimestamp(details.published_at) || "unknown";
    endorsementsEl.textContent = details.endorsements_count ?? 0;
    endorsementsEl.href = `/endorsements.html?d=${encodeURIComponent(details.d)}`;
    proposalsEl.textContent = details.proposals_count ?? 0;
    proposalsEl.href = `/proposals.html?d=${encodeURIComponent(details.d)}`;

    renderNSR(details.nsr || []);
  } catch (error) {
    renderEmpty();
  }
}

initRelayControls(() => load());
initSigner();
const endorseButton = document.getElementById("endorse-submit");
endorseButton.addEventListener("click", async () => {
  const status = document.getElementById("endorse-status");
  endorseButton.disabled = true;
  status.textContent = "Signing and publishing…";
  try {
    const details = await loadData().then(({ data }) => data.details(getQueryParam("d"), getQueryParam("event")));
    if (!details) throw new Error("NCC document is no longer available");
    await publishEndorsement({
      d: details.d,
      eventId: details.event_id,
      role: document.getElementById("endorse-role").value,
      implementation: document.getElementById("endorse-implementation").value.trim(),
      note: document.getElementById("endorse-note").value.trim()
    });
    status.textContent = "Endorsement published.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    endorseButton.disabled = !document.getElementById("signer-toggle").textContent.startsWith("Signed in");
  }
});
load();
