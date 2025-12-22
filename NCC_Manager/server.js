import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { deleteDraft, getDbPath, getDraft, listDrafts, upsertDraft } from "./src/server_store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 5179);
const HOST = process.env.HOST || "127.0.0.1";

const DEFAULT_RELAYS = (process.env.NCC_RELAYS ||
  "wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band,wss://nostr.wine,wss://relay.primal.net,wss://nostr-01.yakihonne.com")
  .split(",")
  .map((relay) => relay.trim())
  .filter(Boolean);

const SERVER_STORAGE = process.env.NCC_SERVER_STORE !== "0";

app.use(express.json({ limit: "1mb" }));

app.get("/api/defaults", (req, res) => {
  res.json({
    relays: DEFAULT_RELAYS,
    storage: {
      server: SERVER_STORAGE
    },
    app: {
      name: "NCC Manager",
      version: "0.1.0"
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


const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));

app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`NCC Manager running at http://${HOST}:${PORT}`);
});
