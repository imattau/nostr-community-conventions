let serverStatus = null;
const fallbackDrafts = new Map();
const fallbackConfig = new Map();

async function checkServerStorage() {
  if (serverStatus !== null) return serverStatus;
  try {
    const res = await fetch("/api/storage");
    if (!res.ok) throw new Error("Server storage unavailable");
    const data = await res.json();
    serverStatus = Boolean(data.server);
  } catch (error) {
    serverStatus = false;
  }
  return serverStatus;
}

async function serverRequest(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const error = payload?.error || "Server error";
    throw new Error(error);
  }
  return res.json();
}

export async function saveDraft(draft) {
  const now = Date.now();
  const data = {
    ...draft,
    updated_at: now,
    created_at: draft.created_at || now
  };
  try {
    if (await checkServerStorage()) {
      await serverRequest("/api/drafts", {
        method: "POST",
        body: JSON.stringify(data)
      });
      fallbackDrafts.set(data.id, data);
      return data;
    }
  } catch (error) {
    // ignore
  }
  fallbackDrafts.set(data.id, data);
  return data;
}

export async function getDraft(id) {
  try {
    if (await checkServerStorage()) {
      const data = await serverRequest(`/api/drafts/${id}`);
      if (data?.draft) {
        fallbackDrafts.set(id, data.draft);
        return data.draft;
      }
    }
  } catch (error) {
    // ignore
  }
  return fallbackDrafts.get(id) || null;
}

export async function deleteDraft(id) {
  try {
    if (await checkServerStorage()) {
      await serverRequest(`/api/drafts/${id}`, { method: "DELETE" });
      fallbackDrafts.delete(id);
      return;
    }
  } catch (error) {
    // ignore
  }
  fallbackDrafts.delete(id);
}

export async function listDrafts(kind) {
  try {
    if (await checkServerStorage()) {
      const url = kind ? `/api/drafts?kind=${kind}` : "/api/drafts";
      const data = await serverRequest(url);
      if (Array.isArray(data?.drafts)) {
        for (const draft of data.drafts || []) {
          if (draft?.id) {
            fallbackDrafts.set(draft.id, draft);
          }
        }
        return data.drafts;
      }
    }
  } catch (error) {
    // ignore
  }
  const drafts = Array.from(fallbackDrafts.values());
  const filtered = kind ? drafts.filter((draft) => draft.kind === kind) : drafts;
  return filtered.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
}

export async function listRecentDrafts(limit = 5) {
  const drafts = await listDrafts();
  return drafts.slice(0, limit);
}

export async function setConfig(key, value) {
  fallbackConfig.set(key, value);
}

export async function getConfig(key, fallback = null) {
  if (fallbackConfig.has(key)) {
    return fallbackConfig.get(key);
  }
  return fallback;
}

export async function getAllConfig() {
  const entries = [];
  for (const [key, value] of fallbackConfig) {
    entries.push({ key, value });
  }
  return entries;
}

export async function persistRelayEvent(event) {
  if (!event?.id) return;
  try {
    if (!(await checkServerStorage())) return;
    await serverRequest("/api/relay-events", {
      method: "POST",
      body: JSON.stringify(event)
    });
  } catch (error) {
    // ignore
  }
}
