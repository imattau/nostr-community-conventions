import sqlite3 from "sqlite3";
import fs from "fs";
import path from "path";
import envPaths from "env-paths";

const paths = envPaths("ncc-manager");
const defaultDbDir = paths.data;
const defaultDbPath = path.join(defaultDbDir, "ncc_manager.sqlite");
const DB_PATH = process.env.NCC_MANAGER_DB || defaultDbPath;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(
    `
    create table if not exists drafts (
      id text primary key,
      kind integer,
      status text,
      updated_at integer,
      data text
    )
    `
  );
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function normalizeDraft(draft) {
  const now = Date.now();
  return {
    ...draft,
    updated_at: draft.updated_at || now,
    created_at: draft.created_at || now
  };
}

export async function upsertDraft(draft) {
  const normalized = normalizeDraft(draft);
  const payload = JSON.stringify(normalized);
  await run(
    `
    insert into drafts (id, kind, status, updated_at, data)
    values (?, ?, ?, ?, ?)
    on conflict(id) do update set
      kind = excluded.kind,
      status = excluded.status,
      updated_at = excluded.updated_at,
      data = excluded.data
    `,
    [normalized.id, normalized.kind, normalized.status || "draft", normalized.updated_at, payload]
  );
  return normalized;
}

export async function deleteDraft(id) {
  await run("delete from drafts where id = ?", [id]);
}

export async function getDraft(id) {
  const row = await get("select data from drafts where id = ?", [id]);
  if (!row) return null;
  return JSON.parse(row.data);
}

export async function listDrafts(kind) {
  const rows = kind
    ? await all("select data from drafts where kind = ? order by updated_at desc", [kind])
    : await all("select data from drafts order by updated_at desc");
  return rows.map((row) => JSON.parse(row.data));
}

export async function listDraftData(kind) {
  const rows = await all("select data from drafts where kind = ?", [kind]);
  return rows.map((row) => JSON.parse(row.data));
}

export function getDbPath() {
  return DB_PATH;
}
