import { openDB } from "idb";

const DB_NAME = "ncc-manager";
const DB_VERSION = 1;
let serverStatus = null;

async function getDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("drafts")) {
        const store = db.createObjectStore("drafts", { keyPath: "id" });
        store.createIndex("kind", "kind", { unique: false });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("updated_at", "updated_at", { unique: false });
      }
      if (!db.objectStoreNames.contains("config")) {
        db.createObjectStore("config", { keyPath: "key" });
      }
    }
  });
}

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
    }
  } catch (error) {
    // Fall back to local storage when server fails.
  }
  const db = await getDb();
  await db.put("drafts", data);
  return data;
}

export async function getDraft(id) {
  try {
    if (await checkServerStorage()) {
      const data = await serverRequest(`/api/drafts/${id}`);
      if (data?.draft) return data.draft;
    }
  } catch (error) {
    // ignore, fall back to local
  }
  const db = await getDb();
  return db.get("drafts", id);
}

export async function deleteDraft(id) {
  try {
    if (await checkServerStorage()) {
      await serverRequest(`/api/drafts/${id}`, { method: "DELETE" });
    }
  } catch (error) {
    // ignore, fall back to local
  }
  const db = await getDb();
  return db.delete("drafts", id);
}

export async function listDrafts(kind) {
  try {
    if (await checkServerStorage()) {
      const url = kind ? `/api/drafts?kind=${kind}` : "/api/drafts";
      const data = await serverRequest(url);
      if (Array.isArray(data?.drafts)) return data.drafts;
    }
  } catch (error) {
    // ignore, fall back to local
  }
  const db = await getDb();
  let drafts = [];
  if (kind) {
    drafts = await db.getAllFromIndex("drafts", "kind", kind);
  } else {
    drafts = await db.getAll("drafts");
  }
  return drafts.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
}

export async function listRecentDrafts(limit = 5) {
  const drafts = await listDrafts();
  return drafts.slice(0, limit);
}

export async function setConfig(key, value) {
  const db = await getDb();
  return db.put("config", { key, value });
}

export async function getConfig(key, fallback = null) {
  const db = await getDb();
  const result = await db.get("config", key);
  return result ? result.value : fallback;
}

export async function getAllConfig() {
  const db = await getDb();
  return db.getAll("config");
}
