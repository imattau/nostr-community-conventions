import express from "express";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  upsertDraft,
  deleteDraft,
  getDraft,
  listDrafts,
  listDraftData,
  getDbPath
} from "./src/server_store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load version from package.json
const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));
const APP_VERSION = pkg.version;

const app = express();
const PORT = Number(process.env.PORT || 5179);
const HOST = process.env.HOST || "127.0.0.1";

const DEFAULT_RELAYS = (
  process.env.NCC_RELAYS ||
  "wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band,wss://nostr.wine,wss://relay.primal.net,wss://nostr-01.yakihonne.com"
)
  .split(",")
  .map((relay) => relay.trim())
  .filter(Boolean);

const SERVER_STORAGE = process.env.NCC_SERVER_STORE !== "0";
const KINDS = {
  endorsement: 30052
};

app.use(express.json({ limit: "1mb" }));

app.get("/api/defaults", (req, res) => {
  res.json({
    relays: DEFAULT_RELAYS,
    storage: {
      server: SERVER_STORAGE
    },
    app: {
      name: "NCC Manager",
      version: APP_VERSION
    }
  });
});

app.get("/api/storage", (req, res) => {
  res.json({
    server: SERVER_STORAGE,
    db_path: SERVER_STORAGE ? getDbPath() : null
  });
});

app.get("/api/drafts", async (req, res) => {
  if (!SERVER_STORAGE) return res.status(404).json({ error: "Server storage disabled" });
  try {
    const kind = req.query.kind ? Number(req.query.kind) : null;
    const drafts = await listDrafts(kind);
    res.json({ drafts });
  } catch (error) {
    res.status(500).json({ error: "Failed to list drafts", detail: error.message });
  }
});

app.get("/api/drafts/:id", async (req, res) => {
  if (!SERVER_STORAGE) return res.status(404).json({ error: "Server storage disabled" });
  try {
    const draft = await getDraft(req.params.id);
    if (!draft) return res.status(404).json({ error: "Draft not found" });
    res.json({ draft });
  } catch (error) {
    res.status(500).json({ error: "Failed to load draft", detail: error.message });
  }
});

app.post("/api/drafts", async (req, res) => {
  if (!SERVER_STORAGE) return res.status(404).json({ error: "Server storage disabled" });
  try {
    const draft = req.body;
    if (!draft?.id || !draft?.kind) {
      return res.status(400).json({ error: "Draft must include id and kind" });
    }
    const saved = await upsertDraft(draft);
    res.json({ draft: saved });
  } catch (error) {
    res.status(500).json({ error: "Failed to save draft", detail: error.message });
  }
});

app.delete("/api/drafts/:id", async (req, res) => {
  if (!SERVER_STORAGE) return res.status(404).json({ error: "Server storage disabled" });
  try {
    await deleteDraft(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete draft", detail: error.message });
  }
});

const distPath = join(__dirname, "dist");
app.use(express.static(distPath));

function normalizeEventId(value) {
  if (!value) return "";
  return value
    .replace(/^event:/i, "")
    .trim()
    .toLowerCase();
}

function extractTagEntries(value) {
  if (!value || typeof value !== "object") return [];
  const tags = [];
  const push = (key, entry) => {
    if (!entry) return;
    tags.push([key, String(entry)]);
  };
  Object.entries(value).forEach(([key, entry]) => {
    if (Array.isArray(entry)) {
      entry.forEach((item) => push(key, item));
    } else {
      push(key, entry);
    }
  });
  return tags;
}

function storedTagsForDraft(draft) {
  if (Array.isArray(draft.raw_tags) && draft.raw_tags.length) {
    return draft.raw_tags;
  }
  if (Array.isArray(draft.tags) && draft.tags.length) {
    return draft.tags;
  }
  return extractTagEntries(draft.tags);
}

app.get("/api/endorsements/counts", async (req, res) => {
  if (!SERVER_STORAGE) return res.json({ counts: {} });
  try {
    const rows = await listDraftData(KINDS.endorsement);
    const counts = {};
    for (const draft of rows || []) {
      if (!draft) continue;
      const status = String(draft.status || "").toLowerCase();
      if (status !== "published") continue;
      const tags = storedTagsForDraft(draft);
      const targets = new Set();
      const endorses = tags.find((tag) => tag[0] === "endorses")?.[1];
      if (endorses) targets.add(normalizeEventId(endorses));
      for (const tag of tags) {
        if (tag[0] === "e" && tag[1]) {
          targets.add(normalizeEventId(tag[1]));
        }
      }
      for (const target of targets) {
        if (!target) continue;
        counts[target] = (counts[target] || 0) + 1;
      }
    }
    res.json({ counts });
  } catch (error) {
    res.status(500).json({ counts: {}, error: "Failed to aggregate endorsement counts" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(join(distPath, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`NCC Manager running at http://${HOST}:${PORT}`);
});
