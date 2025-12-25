import { openDB } from "idb";

const DB_NAME = "ncc-manager-db";
const DB_VERSION = 1;
const DRAFT_STORE_NAME = "drafts";
const CONFIG_STORE_NAME = "config";

let db;

async function getDb() {
  if (!db) {
    db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(DRAFT_STORE_NAME)) {
          db.createObjectStore(DRAFT_STORE_NAME, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(CONFIG_STORE_NAME)) {
          db.createObjectStore(CONFIG_STORE_NAME, { keyPath: "key" });
        }
      }
    });
  }
  return db;
}

let serverStatus = null; // Caches the server storage availability

async function checkServerStorage() {
  if (serverStatus !== null) return serverStatus;
  try {
    const res = await fetch("/api/storage");
    if (!res.ok) throw new Error("Server storage unavailable");
    const data = await res.json();
    serverStatus = Boolean(data.server);
  } catch (_error) {
    void _error; // Explicitly consume unused variable
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
    const error = payload?.error || `Server error: ${res.status} ${res.statusText}`;
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
      return data;
    }
  } catch (_error) {
    void _error; // Explicitly consume unused variable
    console.warn("Server save failed, falling back to IndexedDB:", _error);
  }

  // Fallback to IndexedDB
  const database = await getDb();
  await database.put(DRAFT_STORE_NAME, data);
  return data;
}

export async function getDraft(id) {
  try {
    if (await checkServerStorage()) {
      const data = await serverRequest(`/api/drafts/${id}`);
      if (data?.draft) return data.draft;
    }
  } catch (_error) {
    void _error; // Explicitly consume unused variable
    console.warn("Server fetch failed, falling back to IndexedDB:", _error);
  }

  // Fallback to IndexedDB
  const database = await getDb();
  return await database.get(DRAFT_STORE_NAME, id);
}

export async function deleteDraft(id) {
  try {
    if (await checkServerStorage()) {
      await serverRequest(`/api/drafts/${id}`, { method: "DELETE" });
      return;
    }
  } catch (_error) {
    void _error; // Explicitly consume unused variable
    console.warn("Server delete failed, falling back to IndexedDB:", _error);
  }

  // Fallback to IndexedDB
  const database = await getDb();
  await database.delete(DRAFT_STORE_NAME, id);
}

export async function listDrafts(kind) {
  try {
    if (await checkServerStorage()) {
      const url = kind ? `/api/drafts?kind=${kind}` : "/api/drafts";
      const data = await serverRequest(url);
      if (Array.isArray(data?.drafts)) {
        return data.drafts;
      }
    }
  } catch (_error) {
    void _error; // Explicitly consume unused variable
    console.warn("Server list failed, falling back to IndexedDB:", _error);
  }

  // Fallback to IndexedDB
  const database = await getDb();
  let drafts = await database.getAll(DRAFT_STORE_NAME);
  if (kind) {
    drafts = drafts.filter((draft) => draft.kind === kind);
  }
  return drafts.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
}

export async function setConfig(key, value) {
  try {
    const database = await getDb();
    await database.put(CONFIG_STORE_NAME, { key, value });
  } catch (_error) {
    void _error; // Explicitly consume unused variable
    console.error("Failed to set config in IndexedDB:", _error);
  }
}

export async function getConfig(key, fallback = null) {
  try {
    const database = await getDb();
    const entry = await database.get(CONFIG_STORE_NAME, key);
    return entry ? entry.value : fallback;
  } catch (_error) {
    void _error; // Explicitly consume unused variable
    console.error("Failed to get config from IndexedDB:", _error);
    return fallback;
  }
}

export async function getAllConfig() {
  try {
    const database = await getDb();
    const entries = await database.getAll(CONFIG_STORE_NAME);
    return entries;
  } catch (_error) {
    void _error; // Explicitly consume unused variable
    console.error("Failed to get all config from IndexedDB:", _error);
    return [];
  }
}

// NOTE: fetchEndorsementCounts is moved to main.js as it's an API call, not storage.
