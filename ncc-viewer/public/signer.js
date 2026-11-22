import { finalizeEvent, generateSecretKey, getPublicKey, nip04, nip44 } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";
import { getRelays } from "./data.js";

const pool = new SimplePool();
const DEFAULT_CONNECT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
const pending = new Map();
const state = { type: "", pubkey: "", secret: null, clientPubkey: "", remotePubkey: "", relays: [], sub: null, encryption: "nip04" };

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
function stopNip46() {
  state.sub?.close();
  Object.assign(state, { type: "", pubkey: "", secret: null, clientPubkey: "", remotePubkey: "", relays: [], sub: null, encryption: "nip04" });
  for (const request of pending.values()) request.reject(new Error("NIP-46 disconnected"));
  pending.clear();
}
async function encrypt(peer, content) {
  const secret = hex(state.secret);
  if (state.encryption === "nip44") return nip44.encrypt(content, nip44.getConversationKey(secret, peer));
  return nip04.encrypt(secret, peer, content);
}
async function decrypt(peer, content) {
  if (content.includes("?iv=")) { state.encryption = "nip04"; return nip04.decrypt(hex(state.secret), peer, content); }
  state.encryption = "nip44";
  return nip44.decrypt(content, nip44.getConversationKey(hex(state.secret), peer));
}
function publishTo(relays, event) {
  return Promise.allSettled(pool.publish(relays, event));
}
async function sendRequest(method, params) {
  if (!state.remotePubkey || !state.relays.length) throw new Error("NIP-46 signer is not connected");
  const id = crypto.randomUUID();
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("NIP-46 request timed out")); }, 60000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
  });
  try {
    const payload = await encrypt(state.remotePubkey, JSON.stringify({ id, method, params }));
    await publishTo(state.relays, finalizeEvent({ kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [["p", state.remotePubkey]], content: payload }, state.secret));
  } catch (error) { pending.get(id)?.reject(error); pending.delete(id); }
  return result;
}
async function handleNip46Event(event) {
  if (event.kind !== 24133) return;
  if (state.remotePubkey && state.remotePubkey !== event.pubkey) return;
  let payload;
  try { payload = JSON.parse(await decrypt(event.pubkey, event.content)); } catch { return; }
  if (payload.id && pending.has(payload.id)) {
    const request = pending.get(payload.id); pending.delete(payload.id);
    payload.error ? request.reject(new Error(String(payload.error))) : request.resolve(payload.result);
    return;
  }
  if (payload.method === "connect" && !state.remotePubkey) {
    state.remotePubkey = event.pubkey;
    const response = await encrypt(event.pubkey, JSON.stringify({ id: payload.id, result: "ack" }));
    await publishTo(state.relays, finalizeEvent({ kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [["p", event.pubkey]], content: response }, state.secret));
    state.type = "nip46";
    state.pubkey = event.pubkey;
    renderSigner();
  }
}
function validBunker(value) {
  const url = new URL(value);
  const target = url.hostname || url.pathname.replace(/^\//, "");
  if (url.protocol !== "bunker:" || !target) throw new Error("Enter a valid bunker:// address");
  const relays = url.searchParams.getAll("relay").filter((r) => /^wss?:\/\//i.test(r));
  if (!relays.length) throw new Error("The bunker address needs at least one relay parameter");
  return { pubkey: target, relays };
}
async function connectBunker(value) {
  stopNip46();
  const bunker = validBunker(value);
  state.secret = generateSecretKey(); state.clientPubkey = getPublicKey(state.secret);
  state.remotePubkey = bunker.pubkey; state.relays = bunker.relays;
  state.sub = pool.subscribe(state.relays, { kinds: [24133], authors: [state.remotePubkey], "#p": [state.clientPubkey] }, { onevent: handleNip46Event });
  await sendRequest("connect", [state.clientPubkey]);
  const pubkey = await sendRequest("get_public_key", []);
  if (!/^[0-9a-f]{64}$/i.test(pubkey)) throw new Error("Signer returned an invalid public key");
  state.type = "nip46"; state.pubkey = pubkey; renderSigner();
}
async function beginNostrConnect() {
  stopNip46(); state.secret = generateSecretKey(); state.clientPubkey = getPublicKey(state.secret); state.relays = DEFAULT_CONNECT_RELAYS;
  state.sub = pool.subscribe(state.relays, { kinds: [24133], "#p": [state.clientPubkey] }, { onevent: handleNip46Event });
  return `nostrconnect://${state.clientPubkey}?${state.relays.map((relay) => `relay=${encodeURIComponent(relay)}`).join("&")}`;
}
async function getSigner() {
  if (state.type === "nip07") return { pubkey: state.pubkey, signEvent: (event) => window.nostr.signEvent(event) };
  if (state.type === "nip46") return { pubkey: state.pubkey, signEvent: (event) => sendRequest("sign_event", [event]) };
  if (window.nostr?.getPublicKey && window.nostr?.signEvent) {
    const pubkey = await window.nostr.getPublicKey();
    state.type = "nip07"; state.pubkey = pubkey; renderSigner();
    return { pubkey, signEvent: (event) => window.nostr.signEvent(event) };
  }
  throw new Error("Connect a NIP-07 extension or NIP-46 signer first");
}
function renderSigner() {
  const button = document.getElementById("signer-toggle");
  if (button) button.textContent = state.pubkey ? `Signed in · ${state.pubkey.slice(0, 8)}` : "Sign in";
  const endorsement = document.getElementById("endorse-submit");
  if (endorsement) endorsement.disabled = !state.pubkey;
}

async function getPublishRelays(pubkey) {
  const configured = getRelays();
  try {
    const events = await pool.querySync(configured, { kinds: [10002], authors: [pubkey], limit: 1 });
    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    const writeRelays = (latest?.tags || [])
      .filter((tag) => tag[0] === "r" && tag[1] && (!tag[2] || tag[2] === "write"))
      .map((tag) => tag[1])
      .filter((relay) => /^wss?:\/\//i.test(relay));
    return [...new Set([...writeRelays, ...configured])];
  } catch {
    return configured;
  }
}

export function initSigner() {
  const button = document.getElementById("signer-toggle");
  if (!button) return;
  renderSigner();
  button.addEventListener("click", () => {
    const dialog = document.createElement("dialog");
    dialog.className = "signer-dialog";
    dialog.innerHTML = `<form method="dialog" class="signer-form"><div class="relay-header"><strong>Nostr signer</strong><button class="link-button" value="cancel">Close</button></div><p class="muted small">Sign with a browser extension (NIP-07) or connect a remote signer (NIP-46).</p><button class="badge" type="button" data-action="nip07">Use browser extension</button><label for="bunker-input">Bunker address (NIP-46)</label><input id="bunker-input" autocomplete="off" placeholder="bunker://…?relay=wss://…"/><button class="badge" type="button" data-action="bunker">Connect bunker</button><button class="badge" type="button" data-action="connect">Create nostrconnect URI</button><textarea id="connect-uri" readonly hidden></textarea><p id="signer-status" class="muted small" aria-live="polite"></p>${state.pubkey ? `<button class="link-button" type="button" data-action="disconnect">Disconnect</button>` : ""}</form>`;
    document.body.append(dialog); dialog.showModal();
    dialog.addEventListener("click", async (event) => {
      const action = event.target?.dataset?.action; if (!action) return;
      const status = dialog.querySelector("#signer-status");
      try {
        if (action === "nip07") {
          if (!window.nostr?.getPublicKey || !window.nostr?.signEvent) throw new Error("No NIP-07 extension found");
          state.pubkey = await window.nostr.getPublicKey(); state.type = "nip07"; renderSigner(); dialog.close();
        } else if (action === "bunker") {
          status.textContent = "Connecting…"; await connectBunker(dialog.querySelector("#bunker-input").value.trim()); status.textContent = "Connected";
        } else if (action === "connect") {
          const uri = await beginNostrConnect(); const field = dialog.querySelector("#connect-uri"); field.hidden = false; field.value = uri; field.select(); await navigator.clipboard?.writeText(uri).catch(() => {}); status.textContent = "Scan or paste this URI into your NIP-46 signer. Keep this page open while it connects.";
        } else if (action === "disconnect") { stopNip46(); state.type = ""; state.pubkey = ""; renderSigner(); dialog.close(); }
      } catch (error) { status.textContent = error.message; }
    });
  });
}

export async function publishEndorsement({ d, eventId, role, implementation, note }) {
  const signer = await getSigner();
  const tags = [["d", d], ["endorses", eventId], ["role", role]];
  if (implementation) tags.push(["implementation", implementation]);
  if (note) tags.push(["note", note]);
  const signed = await signer.signEvent({ kind: 30052, created_at: Math.floor(Date.now() / 1000), tags, content: "" });
  if (signed.pubkey !== signer.pubkey) throw new Error("Signer returned an event for a different account");
  const relays = await getPublishRelays(signer.pubkey);
  const results = await publishTo(relays, signed);
  if (!results.some((result) => result.status === "fulfilled")) throw new Error("No configured relay accepted the endorsement");
  return signed;
}
