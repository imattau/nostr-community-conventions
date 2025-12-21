#!/usr/bin/env python3
"""NCC event publisher.

Builds NCC document (kind 30050) and succession record (kind 30051)
according to README.md, signs them with a Nostr key, and publishes
to relays.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
import subprocess
import shutil
import shlex
import sqlite3
import random
import threading
import uuid
import tempfile
from typing import AsyncIterable, Callable, Dict, Iterable, List, Optional

from nostr_sdk import Client, EventBuilder, Keys, Kind, PublicKey, Tag


def _now() -> int:
    return int(time.time())


def _default_config_path() -> str:
    return _default_db_path()


def _default_db_path() -> str:
    return os.path.expanduser("~/.config/ncc_publish/ncc.sqlite")


def _default_config() -> dict:
    return {
        "privkey": "",
        "relays": [
            "wss://relay.damus.io",
            "wss://relay.snort.social",
            "wss://nos.lol",
        ],
        "tags": {
            "summary": "",
            "topics": [],
            "lang": "",
            "version": "",
            "supersedes": [],
            "license": "",
            "authors": [],
            "steward": "",
            "previous": "",
            "reason": "",
            "effective_at": "",
        },
    }


def _default_ncc_output_path(identifier: str, published_at: int) -> str:
    filename = f"{identifier}_{published_at}.json"
    return os.path.join(os.getcwd(), filename)


def _default_ncc_content_path(identifier: str) -> str:
    filename = f"{identifier}_content.md"
    return os.path.join(os.getcwd(), filename)


def _format_ncc_identifier(raw: str) -> str:
    value = raw.strip()
    if not value:
        return ""
    if value.lower().startswith("ncc-"):
        return value
    return f"ncc-{value}"


def _pad_to_width(text: str, width: int) -> str:
    if width <= 0:
        return text
    if len(text) >= width:
        return text
    return text + (" " * (width - len(text)))


def _normalize_optional_str(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _format_list_default(values: Optional[List[str]]) -> Optional[str]:
    if not values:
        return None
    return ", ".join(values)


def _is_truthy_response(value: str) -> bool:
    return value.strip().lower() in {"y", "yes", "true", "1"}


def _load_json(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return {}


def _load_json_safe(path: str) -> dict:
    try:
        return _load_json(path)
    except json.JSONDecodeError:
        return {}


def _write_json(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=True)
        handle.write("\n")


def _write_text_file(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(content)


_QUEUE_LOCK = threading.Lock()
_PUBLISH_LOCK = threading.Lock()
_QUEUE_WORKER_STARTED = False
_QUEUE_DB_PATHS: set[str] = set()
_QUEUE_POLL_SECONDS = 5
_QUEUE_MAX_ATTEMPTS = 5
_QUEUE_BASE_DELAY = 30
_QUEUE_MAX_DELAY = 3600
_QUEUE_JITTER = 0.2

_CONFIG_KEY = "root"


def _load_config_db(config_path: Optional[str]) -> dict:
    conn = _db_connect(config_path)
    row = conn.execute("select value from config where key = ?", (_CONFIG_KEY,)).fetchone()
    conn.close()
    if not row:
        return {}
    try:
        return json.loads(row["value"])
    except (json.JSONDecodeError, TypeError):
        return {}


def _write_config_db(config_path: str, data: dict) -> None:
    conn = _db_connect(config_path)
    payload = json.dumps(data, indent=2, ensure_ascii=True)
    conn.execute(
        """
        insert into config (key, value) values (?, ?)
        on conflict(key) do update set value = excluded.value
        """,
        (_CONFIG_KEY, payload),
    )
    conn.commit()
    conn.close()


def _edit_config_db(config_path: str, open_editor: Callable[[str], None]) -> None:
    config = _load_config_db(config_path) or _default_config()
    with tempfile.NamedTemporaryFile(prefix="ncc-config-", suffix=".json", delete=False) as handle:
        temp_path = handle.name
    _write_json(temp_path, config)
    open_editor(temp_path)
    try:
        edited = _load_json(temp_path)
    except json.JSONDecodeError:
        raise SystemExit("Edited config is not valid JSON.")
    finally:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
    if not isinstance(edited, dict):
        raise SystemExit("Edited config must be a JSON object.")
    _write_config_db(config_path, edited)


def _config_exists(config_path: str) -> bool:
    conn = _db_connect(config_path)
    row = conn.execute("select 1 from config where key = ? limit 1", (_CONFIG_KEY,)).fetchone()
    conn.close()
    return row is not None


def _queue_db_path(config_path: Optional[str]) -> str:
    return _resolve_db_path(config_path)


def _register_queue_db_path(config_path: Optional[str]) -> None:
    db_path = _queue_db_path(config_path)
    with _QUEUE_LOCK:
        _QUEUE_DB_PATHS.add(db_path)


def _compute_retry_delay(attempts: int) -> int:
    base = min(_QUEUE_MAX_DELAY, _QUEUE_BASE_DELAY * (2 ** max(attempts - 1, 0)))
    jitter = 1.0 + random.uniform(-_QUEUE_JITTER, _QUEUE_JITTER)
    return max(1, int(base * jitter))


def _enqueue_publish_task(task: dict) -> None:
    now = _now()
    task.setdefault("id", uuid.uuid4().hex)
    task.setdefault("created_at", now)
    task.setdefault("attempts", 0)
    task.setdefault("max_attempts", _QUEUE_MAX_ATTEMPTS)
    task.setdefault("next_attempt_at", now + _compute_retry_delay(task["attempts"] + 1))
    config_path = task.get("config_path")
    _register_queue_db_path(config_path)
    db_path = _queue_db_path(config_path)
    conn = _db_connect_path(db_path)
    conn.execute(
        """
        insert into publish_queue (
            task_id,
            config_path,
            task_type,
            draft_id,
            json_path,
            payload,
            relays,
            attempts,
            max_attempts,
            next_attempt_at,
            created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            task["id"],
            config_path,
            task.get("type"),
            task.get("draft_id"),
            task.get("json_path"),
            json.dumps(task.get("payload")) if task.get("payload") is not None else None,
            json.dumps(task.get("relays") or []),
            int(task.get("attempts", 0)),
            int(task.get("max_attempts", _QUEUE_MAX_ATTEMPTS)),
            int(task.get("next_attempt_at")),
            int(task.get("created_at")),
        ),
    )
    conn.commit()
    conn.close()


def _queue_notice(output: Optional[Callable[[str], None]], message: str) -> None:
    if output:
        output(message)


def _resolve_relays(relays: Optional[List[str]], config: dict) -> List[str]:
    if relays:
        return relays
    if isinstance(config, dict):
        return config.get("relays", []) or []
    return []


def _load_privkey_from_config(config_path: Optional[str]) -> Optional[str]:
    if not config_path:
        return None
    config = _load_config_db(config_path)
    if isinstance(config, dict):
        return config.get("privkey")
    return None


def _attempt_publish_payload(payload: dict, *, relays: List[str], keys: Keys) -> str:
    _prepare_payload_for_publish(payload)
    builder = build_event_from_json(payload)
    return asyncio.run(publish_event(builder, relays=relays, keys=keys))


def _attempt_publish_json(json_path: str, *, relays: List[str], keys: Keys) -> str:
    payload = _load_json(json_path)
    event_id = _attempt_publish_payload(payload, relays=relays, keys=keys)
    _finalize_payload_publish(payload, event_id)
    _write_json(json_path, payload)
    return event_id


def _attempt_publish_draft(config_path: str, draft_id: int, *, relays: List[str], keys: Keys) -> str:
    conn = _db_connect(config_path)
    draft = conn.execute("select * from drafts where id = ?", (int(draft_id),)).fetchone()
    if not draft:
        conn.close()
        raise SystemExit("Draft not found.")
    tags = _db_get_tags(conn, draft["id"])
    conn.close()
    payload = _payload_from_draft(draft["kind"], draft["d"], draft["title"], draft["content"], tags, _now())
    event_id = _attempt_publish_payload(payload, relays=relays, keys=keys)
    published_at = _now() if draft["kind"] == 30050 else None
    tags = _add_or_replace_tag(tags, "eventid", event_id)
    if published_at is not None:
        tags = _add_or_replace_tag(tags, "published_at", str(published_at))
    conn = _db_connect(config_path)
    _db_update_draft(
        conn,
        draft_id=int(draft["id"]),
        title=draft["title"],
        content=draft["content"],
        tags=tags,
        status="published",
        published_at=published_at,
        event_id=event_id,
    )
    conn.close()
    return event_id


def _run_publish_task(task: dict) -> str:
    config_path = task.get("config_path")
    config = _load_config_db(config_path) if config_path else {}
    relays = _resolve_relays(task.get("relays"), config)
    privkey = _load_privkey_from_config(config_path)
    if not privkey:
        raise SystemExit("Missing privkey for queued publish.")
    keys = Keys.parse(privkey)
    kind = task.get("type")
    if kind == "draft":
        return _attempt_publish_draft(config_path, int(task["draft_id"]), relays=relays, keys=keys)
    if kind == "json":
        return _attempt_publish_json(task["json_path"], relays=relays, keys=keys)
    if kind == "payload":
        payload = task.get("payload")
        if not isinstance(payload, dict):
            raise SystemExit("Queued payload is invalid.")
        return _attempt_publish_payload(payload, relays=relays, keys=keys)
    raise SystemExit("Unknown queued publish type.")


def _queue_row_to_task(row: sqlite3.Row) -> dict:
    relays_raw = row["relays"] or "[]"
    payload_raw = row["payload"]
    return {
        "id": row["task_id"],
        "type": row["task_type"],
        "config_path": row["config_path"],
        "draft_id": row["draft_id"],
        "json_path": row["json_path"],
        "payload": json.loads(payload_raw) if payload_raw else None,
        "relays": json.loads(relays_raw) if relays_raw else [],
        "attempts": row["attempts"],
        "max_attempts": row["max_attempts"],
        "next_attempt_at": row["next_attempt_at"],
        "created_at": row["created_at"],
    }


def _process_publish_queue_db(db_path: str, output: Optional[Callable[[str], None]] = None) -> bool:
    conn = _db_connect_path(db_path)
    now = _now()
    row = conn.execute(
        """
        select * from publish_queue
        where next_attempt_at <= ?
        order by next_attempt_at asc
        limit 1
        """,
        (now,),
    ).fetchone()
    conn.close()
    if not row:
        return False
    task = _queue_row_to_task(row)
    try:
        with _PUBLISH_LOCK:
            event_id = _run_publish_task(task)
        _queue_notice(output, f"Queued publish succeeded (event {event_id}).")
        conn = _db_connect_path(db_path)
        conn.execute("delete from publish_queue where id = ?", (int(row["id"]),))
        conn.commit()
        conn.close()
        return True
    except Exception as exc:
        attempts = int(task.get("attempts", 0)) + 1
        max_attempts = int(task.get("max_attempts", _QUEUE_MAX_ATTEMPTS))
        conn = _db_connect_path(db_path)
        if attempts >= max_attempts:
            conn.execute("delete from publish_queue where id = ?", (int(row["id"]),))
            conn.commit()
            conn.close()
            _queue_notice(output, f"Queued publish failed permanently after {attempts} attempts: {exc}")
        else:
            delay = _compute_retry_delay(attempts + 1)
            next_attempt_at = _now() + delay
            conn.execute(
                """
                update publish_queue
                set attempts = ?, next_attempt_at = ?, last_error = ?
                where id = ?
                """,
                (attempts, next_attempt_at, str(exc), int(row["id"])),
            )
            conn.commit()
            conn.close()
            _queue_notice(output, f"Queued publish failed (attempt {attempts}/{max_attempts}): {exc}")
        return True


def _process_publish_queue_once(output: Optional[Callable[[str], None]] = None) -> None:
    with _QUEUE_LOCK:
        db_paths = list(_QUEUE_DB_PATHS or {_default_db_path()})
    for db_path in db_paths:
        if _process_publish_queue_db(db_path, output):
            break


def _queue_worker_loop(output: Optional[Callable[[str], None]] = None) -> None:
    while True:
        _process_publish_queue_once(output)
        time.sleep(_QUEUE_POLL_SECONDS)


def _start_publish_queue_worker(output: Optional[Callable[[str], None]] = None) -> None:
    global _QUEUE_WORKER_STARTED
    if _QUEUE_WORKER_STARTED:
        return
    _QUEUE_WORKER_STARTED = True
    _register_queue_db_path(None)
    worker = threading.Thread(target=_queue_worker_loop, args=(output,), daemon=True)
    worker.start()


def _resolve_db_path(config_path: Optional[str]) -> str:
    if config_path:
        return os.path.expanduser(config_path)
    return _default_db_path()


def _db_connect(config_path: Optional[str]) -> sqlite3.Connection:
    db_path = _resolve_db_path(config_path)
    return _db_connect_path(db_path)


def _db_connect_path(db_path: str) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    _db_init(conn)
    return conn


def _db_init(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        create table if not exists drafts (
            id integer primary key,
            kind integer not null,
            d text not null,
            title text,
            content text,
            created_at integer,
            updated_at integer,
            published_at integer,
            event_id text,
            status text
        )
        """
    )
    conn.execute(
        """
        create table if not exists tags (
            draft_id integer not null,
            key text not null,
            value text not null,
            foreign key(draft_id) references drafts(id)
        )
        """
    )
    conn.execute(
        """
        create table if not exists config (
            key text primary key,
            value text not null
        )
        """
    )
    conn.execute("create index if not exists idx_drafts_kind_d on drafts(kind, d)")
    conn.execute("create index if not exists idx_drafts_updated on drafts(updated_at)")
    conn.execute("create index if not exists idx_tags_draft on tags(draft_id)")
    conn.execute(
        """
        create table if not exists publish_queue (
            id integer primary key,
            task_id text not null,
            config_path text,
            task_type text not null,
            draft_id integer,
            json_path text,
            payload text,
            relays text,
            attempts integer not null,
            max_attempts integer not null,
            next_attempt_at integer not null,
            created_at integer not null,
            last_error text
        )
        """
    )
    conn.execute("create index if not exists idx_publish_queue_next on publish_queue(next_attempt_at)")
    conn.commit()


def _db_insert_draft(
    conn: sqlite3.Connection,
    *,
    kind: int,
    d: str,
    title: Optional[str],
    content: str,
    tags: List[tuple[str, str]],
    status: str = "draft",
    published_at: Optional[int] = None,
) -> int:
    now = _now()
    cur = conn.execute(
        """
        insert into drafts (kind, d, title, content, created_at, updated_at, published_at, status)
        values (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (kind, d, title, content, now, now, published_at, status),
    )
    draft_id = int(cur.lastrowid)
    _db_set_tags(conn, draft_id, tags)
    conn.commit()
    return draft_id


def _db_update_draft(
    conn: sqlite3.Connection,
    *,
    draft_id: int,
    title: Optional[str],
    content: str,
    tags: List[tuple[str, str]],
    status: Optional[str] = None,
    published_at: Optional[int] = None,
    event_id: Optional[str] = None,
) -> None:
    now = _now()
    conn.execute(
        """
        update drafts
        set title = ?, content = ?, updated_at = ?, published_at = coalesce(?, published_at),
            event_id = coalesce(?, event_id), status = coalesce(?, status)
        where id = ?
        """,
        (title, content, now, published_at, event_id, status, draft_id),
    )
    _db_set_tags(conn, draft_id, tags)
    conn.commit()


def _db_set_tags(conn: sqlite3.Connection, draft_id: int, tags: List[tuple[str, str]]) -> None:
    conn.execute("delete from tags where draft_id = ?", (draft_id,))
    if tags:
        conn.executemany(
            "insert into tags (draft_id, key, value) values (?, ?, ?)",
            [(draft_id, key, value) for key, value in tags],
        )


def _db_get_latest_draft(conn: sqlite3.Connection, kind: int, d: str) -> Optional[sqlite3.Row]:
    cur = conn.execute(
        """
        select * from drafts
        where kind = ? and d = ?
        order by updated_at desc
        limit 1
        """,
        (kind, d),
    )
    return cur.fetchone()


def _db_get_tags(conn: sqlite3.Connection, draft_id: int) -> List[tuple[str, str]]:
    cur = conn.execute("select key, value from tags where draft_id = ?", (draft_id,))
    return [(row["key"], row["value"]) for row in cur.fetchall()]


def _format_ts(value: Optional[int]) -> str:
    if not value:
        return "-"
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(int(value)))


def _db_list_drafts(conn: sqlite3.Connection, kind: int) -> List[sqlite3.Row]:
    cur = conn.execute(
        """
        select id, d, title, status, updated_at, published_at
        from drafts
        where kind = ?
        order by updated_at desc
        """,
        (kind,),
    )
    return cur.fetchall()


def _open_in_editor(path: str) -> None:
    raw_editor = os.environ.get("EDITOR") or os.environ.get("VISUAL")
    if raw_editor:
        editor_cmd = shlex.split(raw_editor)
    else:
        editor_cmd = []
        for candidate in ("nano", "vi"):
            if shutil.which(candidate):
                editor_cmd = [candidate]
                break
    if not editor_cmd:
        raise SystemExit("No editor found. Set $EDITOR or $VISUAL.")
    try:
        subprocess.run(editor_cmd + [path], check=True)
    except FileNotFoundError as exc:
        raise SystemExit(f"Editor not found: {editor_cmd[0]}") from exc


class _CommandCompleter:
    def __init__(self, commands: List[str], meta: Optional[Dict[str, str]] = None) -> None:
        self._commands = commands
        self._meta = meta or {}

    def get_completions(self, document, complete_event) -> Iterable[object]:
        from prompt_toolkit.completion import Completion
        text = document.text_before_cursor
        token = text.split()[-1] if text.split() else ""
        for cmd in self._commands:
            if cmd.startswith(token):
                yield Completion(
                    cmd,
                    start_position=-len(token),
                    display_meta=self._meta.get(cmd, ""),
                )

    async def get_completions_async(self, document, complete_event) -> AsyncIterable[object]:
        for completion in self.get_completions(document, complete_event):
            yield completion


def _build_command_prompt(commands: List[str], meta: Optional[Dict[str, str]] = None) -> Callable[[], str]:
    try:
        from prompt_toolkit import prompt
        from prompt_toolkit.shortcuts import CompleteStyle
    except Exception:
        prompt = None
        CompleteStyle = None

    if prompt is None:
        def _basic() -> str:
            return input("> ").strip()
        return _basic

    completer = _CommandCompleter(commands, meta=meta)

    def _with_completion() -> str:
        return prompt(
            "> ",
            completer=completer,
            complete_style=CompleteStyle.MULTI_COLUMN,
        ).strip()

    return _with_completion


def _prompt_value(label: str, default: Optional[str] = None, required: bool = False) -> str:
    while True:
        prompt = label
        if default:
            prompt += f" [{default}]"
        prompt += ": "
        value = input(prompt).strip()
        if value == "" and default is not None:
            value = default
        if required and not value:
            print("Value is required.")
            continue
        return value


def _prompt_list(label: str, default: Optional[List[str]] = None) -> List[str]:
    default_value = ",".join(default) if default else ""
    raw = _prompt_value(f"{label} (comma-separated)", default_value or None, required=False)
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def _prompt_config_path() -> str:
    return _default_config_path()


def _prompt_config_path_optional(default_path: str) -> Optional[str]:
    return default_path


def _load_content_from_path(path: str) -> str:
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def _parse_list_value(raw: str) -> List[str]:
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def _validate_author_keys(authors: Optional[List[str]]) -> List[str]:
    if not authors:
        return []
    normalized = [item.strip() for item in authors if item and item.strip()]
    if not normalized:
        return []
    errors = []
    for value in normalized:
        if value.startswith("nsec"):
            errors.append(f"{value} looks like a secret key (nsec)")
            continue
        try:
            PublicKey.parse(value)
        except Exception:
            errors.append(f"{value} is not a valid npub or hex public key")
    if errors:
        raise ValueError("Authors must be npub or hex public keys. Invalid entries: " + "; ".join(errors))
    return normalized


def _extract_tag_value(tags: List[List[str]], key: str) -> Optional[str]:
    for tag in tags:
        if len(tag) >= 2 and tag[0] == key:
            return tag[1]
    return None


def _extract_tag_values(tags: List[List[str]], key: str) -> List[str]:
    return [tag[1] for tag in tags if len(tag) >= 2 and tag[0] == key]


def _strip_event_prefix(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return value.replace("event:", "", 1) if value.startswith("event:") else value


def _ensure_tags(payload: dict) -> List[List[str]]:
    tags = payload.get("tags", [])
    return tags if isinstance(tags, list) else []


def _upsert_single_tag(tags: List[List[str]], key: str, value: str) -> List[List[str]]:
    updated = [tag for tag in tags if isinstance(tag, list) and tag and tag[0] != key]
    updated.append([key, value])
    return updated


def _prepare_payload_for_publish(payload: dict) -> int:
    now = _now()
    payload["created_at"] = now
    tags = _ensure_tags(payload)
    if payload.get("kind") == 30050:
        tags = _upsert_single_tag(tags, "published_at", str(now))
    payload["tags"] = tags
    return now


def _finalize_payload_publish(payload: dict, event_id: str) -> None:
    tags = _ensure_tags(payload)
    payload["tags"] = _upsert_single_tag(tags, "eventid", event_id)


def _tags_to_map(tags: List[tuple[str, str]]) -> dict:
    mapped: dict[str, List[str]] = {}
    for key, value in tags:
        mapped.setdefault(key, []).append(value)
    return mapped


def _add_or_replace_tag(tags: List[tuple[str, str]], key: str, value: str) -> List[tuple[str, str]]:
    filtered = [(k, v) for k, v in tags if k != key]
    filtered.append((key, value))
    return filtered


def _tags_from_payload(payload: dict) -> List[tuple[str, str]]:
    tags: List[tuple[str, str]] = []
    for tag in payload.get("tags", []):
        if not isinstance(tag, list) or len(tag) < 2:
            continue
        key = tag[0]
        if key in ("d", "title"):
            continue
        tags.append((key, str(tag[1])))
    return tags


def _ncc_tags_from_inputs(
    *,
    summary: Optional[str],
    topics: List[str],
    lang: Optional[str],
    version: Optional[str],
    supersedes: List[str],
    license_id: Optional[str],
    authors: List[str],
    published_at: Optional[int] = None,
) -> List[tuple[str, str]]:
    tags: List[tuple[str, str]] = []
    if summary:
        tags.append(("summary", summary))
    for topic in topics:
        tags.append(("t", topic))
    if lang:
        tags.append(("lang", lang))
    if version:
        tags.append(("version", version))
    for item in supersedes:
        tags.append(("supersedes", item))
    if license_id:
        tags.append(("license", license_id))
    for author in authors:
        tags.append(("authors", author))
    if published_at is not None:
        tags.append(("published_at", str(published_at)))
    return tags


def _nsr_tags_from_inputs(
    *,
    authoritative_event: str,
    steward: Optional[str],
    previous: Optional[str],
    reason: Optional[str],
    effective_at: Optional[str],
) -> List[tuple[str, str]]:
    tags: List[tuple[str, str]] = [("authoritative", f"event:{authoritative_event}")]
    if steward:
        tags.append(("steward", steward))
    if previous:
        tags.append(("previous", f"event:{previous}"))
    if reason:
        tags.append(("reason", reason))
    if effective_at:
        tags.append(("effective_at", effective_at))
    return tags


def _payload_from_draft(kind: int, d: str, title: Optional[str], content: str, tags: List[tuple[str, str]], created_at: int) -> dict:
    tag_map = _tags_to_map(tags)
    payload = {
        "kind": kind,
        "created_at": created_at,
        "tags": [],
        "content": content,
    }
    tags_list: List[List[str]] = []
    tags_list.append(["d", d])
    if kind == 30050:
        if title:
            tags_list.append(["title", title])
        published_at = tag_map.get("published_at", [None])[0]
        if published_at:
            tags_list.append(["published_at", published_at])
        if "summary" in tag_map:
            tags_list.append(["summary", tag_map["summary"][0]])
        for topic in tag_map.get("t", []):
            tags_list.append(["t", topic])
        if "lang" in tag_map:
            tags_list.append(["lang", tag_map["lang"][0]])
        if "version" in tag_map:
            tags_list.append(["version", tag_map["version"][0]])
        for item in tag_map.get("supersedes", []):
            tags_list.append(["supersedes", item])
        if "license" in tag_map:
            tags_list.append(["license", tag_map["license"][0]])
        for author in tag_map.get("authors", []):
            tags_list.append(["authors", author])
        if "eventid" in tag_map:
            tags_list.append(["eventid", tag_map["eventid"][0]])
    else:
        if "authoritative" in tag_map:
            tags_list.append(["authoritative", tag_map["authoritative"][0]])
        if "steward" in tag_map:
            tags_list.append(["steward", tag_map["steward"][0]])
        if "previous" in tag_map:
            tags_list.append(["previous", tag_map["previous"][0]])
        if "reason" in tag_map:
            tags_list.append(["reason", tag_map["reason"][0]])
        if "effective_at" in tag_map:
            tags_list.append(["effective_at", tag_map["effective_at"][0]])
        if "eventid" in tag_map:
            tags_list.append(["eventid", tag_map["eventid"][0]])
    payload["tags"] = tags_list
    return payload
def _find_latest_draft(kind: int, identifier: str, cwd: str) -> Optional[tuple[str, dict]]:
    candidates: List[tuple[str, int]] = []
    for name in os.listdir(cwd):
        if not name.endswith(".json"):
            continue
        path = os.path.join(cwd, name)
        try:
            payload = _load_json(path)
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        if payload.get("kind") != kind:
            continue
        tags = payload.get("tags", [])
        if not isinstance(tags, list):
            continue
        d_tag = _extract_tag_value(tags, "d")
        if d_tag != identifier:
            continue
        created_at = payload.get("created_at")
        if isinstance(created_at, int):
            candidates.append((path, created_at))
        else:
            try:
                candidates.append((path, int(os.path.getmtime(path))))
            except OSError:
                continue
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[1], reverse=True)
    latest_path = candidates[0][0]
    return latest_path, _load_json(latest_path)


def _interactive_cli() -> None:
    separator = "-" * 72
    command_meta = {
        "/init-config": "Initialize default config in the database.",
        "/edit-config": "Edit config stored in the database (prompted).",
        "/create-ncc": "Create a draft NCC JSON file.",
        "/create-nsr": "Create a draft succession record JSON file.",
        "/revise-ncc": "Revise an existing NCC draft JSON file.",
        "/revise-nsr": "Revise an existing succession record JSON file.",
        "/list-ncc": "List NCC drafts in the database.",
        "/list-nsr": "List succession record drafts in the database.",
        "/publish-ncc": "Publish the latest NCC draft JSON file.",
        "/publish-nsr": "Publish the latest succession record JSON file.",
        "/help": "Show available commands.",
        "/quit": "Exit interactive mode.",
    }
    commands = list(command_meta)
    read_command = _build_command_prompt(commands, meta=command_meta)
    print("NCC publisher")
    print("Type /help for commands.")
    _start_publish_queue_worker(print)
    while True:
        print("")
        print(separator)
        command = read_command()
        if not command:
            continue
        if not command.startswith("/"):
            print("Error: commands must start with '/'. Type /help for options.")
            continue

        if command in ("/quit", "/exit"):
            return

        if command in ("/help", "?"):
            print("Commands:")
            print("  /init-config")
            print("  /edit-config")
            print("  /create-ncc")
            print("  /create-nsr")
            print("  /revise-ncc")
            print("  /revise-nsr")
            print("  /list-ncc")
            print("  /list-nsr")
            print("  /publish-ncc")
            print("  /publish-nsr")
            print("  /quit")
            print("")
            print("Details:")
            print("  /init-config  Initialize default config in the database.")
            print("  /edit-config  Edit config stored in the database (prompted).")
            print("  /create-ncc   Create a draft NCC JSON file.")
            print("  /create-nsr   Create a draft succession record JSON file.")
            print("  /revise-ncc   Revise an existing NCC draft JSON file.")
            print("  /revise-nsr   Revise an existing succession record JSON file.")
            print("  /list-ncc     List NCC drafts in the database.")
            print("  /list-nsr     List succession record drafts in the database.")
            print("  /publish-ncc  Publish the latest NCC draft JSON file.")
            print("  /publish-nsr  Publish the latest succession record JSON file.")
            print("  /quit         Exit interactive mode.")
            print("")
            print("Getting started:")
            print("  1) /init-config")
            print("  2) /edit-config")
            print("  3) /create-ncc")
            print("  4) /publish-ncc")
            continue

        if command == "/init-config":
            config_path = _default_config_path()
            if _config_exists(config_path):
                confirm = _prompt_value("Config exists. Reset? (y/n)", "n", required=False)
                if not _is_truthy_response(confirm):
                    print("Config unchanged.")
                    continue
            _write_config_db(config_path, _default_config())
            print(f"Initialized config in database at {config_path}")
            configure_now = _prompt_value("Configure now? (y/n)", "y", required=False)
            if _is_truthy_response(configure_now):
                command = "/edit-config"
            else:
                continue

        if command == "/edit-config":
            config_path = _default_config_path()
            if not _config_exists(config_path):
                _write_config_db(config_path, _default_config())
                print(f"Initialized config in database at {config_path}")
            config = _load_config_db(config_path) or _default_config()
            relays = _prompt_list("Relays", config.get("relays") if isinstance(config, dict) else None)
            privkey = _prompt_value(
                "Privkey (nsec or hex, used for signing)",
                config.get("privkey") if isinstance(config, dict) else None,
                required=False,
            )
            if privkey:
                try:
                    Keys.parse(privkey)
                except Exception:
                    print("Error: privkey must be nsec or hex.")
                    continue
            tags = config.get("tags", {}) if isinstance(config, dict) else {}
            summary = _prompt_value("Summary (optional)", tags.get("summary"), required=False)
            topics = _prompt_value(
                "Topics (comma-separated, optional)",
                _format_list_default(tags.get("topics")),
                required=False,
            )
            lang = _prompt_value("Lang (optional)", tags.get("lang"), required=False)
            version = _prompt_value("Version (optional)", tags.get("version"), required=False)
            supersedes = _prompt_value("Supersedes (optional)", tags.get("supersedes"), required=False)
            license_id = _prompt_value("License (optional)", tags.get("license"), required=False)
            authors = _prompt_value(
                "Authors (npub or hex pubkey; comma-separated, optional)",
                _format_list_default(tags.get("authors")),
                required=False,
            )
            steward = _prompt_value("Steward (optional)", tags.get("steward"), required=False)
            previous = _prompt_value("Previous (optional)", tags.get("previous"), required=False)
            reason = _prompt_value("Reason (optional)", tags.get("reason"), required=False)
            effective_at = _prompt_value("Effective at (optional)", tags.get("effective_at"), required=False)
            authors_list = _parse_list_value(authors)
            if authors_list:
                authors_list = _validate_author_keys(authors_list)
            updated = {
                "privkey": privkey or "",
                "relays": relays or [],
                "tags": {
                    "summary": _normalize_optional_str(summary) or "",
                    "topics": _parse_list_value(topics) or [],
                    "lang": _normalize_optional_str(lang) or "",
                    "version": _normalize_optional_str(version) or "",
                    "supersedes": _parse_list_value(supersedes) or [],
                    "license": _normalize_optional_str(license_id) or "",
                    "authors": authors_list or [],
                    "steward": _normalize_optional_str(steward) or "",
                    "previous": _normalize_optional_str(previous) or "",
                    "reason": _normalize_optional_str(reason) or "",
                    "effective_at": _normalize_optional_str(effective_at) or "",
                },
            }
            _write_config_db(config_path, updated)
            print(f"Updated config in database at {config_path}")
            continue

        if command == "/create-ncc":
            default_path = _default_config_path()
            config_path = default_path
            config = _load_config_db(config_path)
            config_tags = config.get("tags", {}) if isinstance(config, dict) else {}
            d_value = _prompt_value("NCC number (e.g. 01)", required=True)
            d_value = _format_ncc_identifier(d_value)
            title_value = _prompt_value("Title", required=True)
            default_content_path = _default_ncc_content_path(d_value)
            content_path = _prompt_value("Content path", default_content_path, required=True)
            if not os.path.exists(content_path):
                _write_text_file(content_path, _ncc_template_content())
            open_now = _prompt_value("Open editor now? (y/n)", "y", required=False)
            if _is_truthy_response(open_now):
                _open_in_editor(content_path)
            content = _load_content_from_path(content_path)
            summary = _prompt_value("Summary (optional)", config_tags.get("summary"), required=False)
            topics = _prompt_value(
                "Topics (comma-separated, optional)",
                _format_list_default(config_tags.get("topics")),
                required=False,
            )
            lang = _prompt_value("Lang (optional)", config_tags.get("lang"), required=False)
            version = _prompt_value("Version (optional)", config_tags.get("version"), required=False)
            supersedes = _prompt_value("Supersedes (optional)", config_tags.get("supersedes"), required=False)
            license_id = _prompt_value("License (optional)", config_tags.get("license"), required=False)
            authors = _prompt_value(
                "Authors (npub or hex pubkey; comma-separated, optional)",
                _format_list_default(config_tags.get("authors")),
                required=False,
            )
            authors_list = _parse_list_value(authors) or config_tags.get("authors") or []
            try:
                authors_list = _validate_author_keys(authors_list)
            except ValueError as exc:
                print(f"Error: {exc}")
                continue
            content = content.replace("# Title", f"# {title_value}", 1)
            tags = _ncc_tags_from_inputs(
                summary=_normalize_optional_str(summary) or config_tags.get("summary"),
                topics=_parse_list_value(topics) or config_tags.get("topics") or [],
                lang=_normalize_optional_str(lang) or config_tags.get("lang"),
                version=_normalize_optional_str(version) or config_tags.get("version"),
                supersedes=_parse_list_value(supersedes) or config_tags.get("supersedes") or [],
                license_id=_normalize_optional_str(license_id) or config_tags.get("license"),
                authors=authors_list,
            )
            conn = _db_connect(config_path)
            draft_id = _db_insert_draft(
                conn,
                kind=30050,
                d=d_value,
                title=title_value,
                content=content,
                tags=tags,
            )
            conn.close()
            export_path = _prompt_value("Export JSON path (optional)", default=None, required=False)
            if export_path:
                payload = _payload_from_draft(30050, d_value, title_value, content, tags, _now())
                _write_json(export_path, payload)
                print(f"Wrote NCC draft JSON to {export_path}")
            print(f"Saved NCC draft to database (id {draft_id}).")
            continue

        if command == "/revise-ncc":
            d_value = _prompt_value("NCC number (e.g. 01)", required=True)
            d_value = _format_ncc_identifier(d_value)
            if not d_value:
                print("Cancelled.")
                continue
            config_path = _default_config_path()
            conn = _db_connect(config_path)
            draft = _db_get_latest_draft(conn, 30050, d_value)
            if not draft:
                conn.close()
                json_path = _prompt_value("Import JSON path (optional)", default=None, required=False)
                if not json_path:
                    print("Cancelled.")
                    continue
                payload = _load_json(json_path)
                tags = _tags_from_payload(payload)
                title_value = _extract_tag_value(payload.get("tags", []), "title")
                content_seed = payload.get("content", "")
                conn = _db_connect(config_path)
                draft_id = _db_insert_draft(
                    conn,
                    kind=30050,
                    d=d_value,
                    title=title_value,
                    content=content_seed,
                    tags=tags,
                )
                conn.close()
                draft = {"id": draft_id, "title": title_value, "content": content_seed}
            else:
                tags = _db_get_tags(conn, draft["id"])
                conn.close()
            tag_map = _tags_to_map(tags)
            title_value = _prompt_value("Title", draft["title"], required=True)
            default_content_path = _default_ncc_content_path(d_value)
            content_path = _prompt_value("Content path", default_content_path, required=True)
            _write_text_file(content_path, draft["content"] or _ncc_template_content())
            open_now = _prompt_value("Open editor now? (y/n)", "y", required=False)
            if _is_truthy_response(open_now):
                _open_in_editor(content_path)
            content = _load_content_from_path(content_path)
            summary = _prompt_value("Summary (optional)", tag_map.get("summary", [None])[0], required=False)
            topics = _prompt_value("Topics (comma-separated, optional)", _format_list_default(tag_map.get("t")), required=False)
            lang = _prompt_value("Lang (optional)", tag_map.get("lang", [None])[0], required=False)
            version = _prompt_value("Version (optional)", tag_map.get("version", [None])[0], required=False)
            supersedes = _prompt_value(
                "Supersedes (optional)",
                _format_list_default(tag_map.get("supersedes")),
                required=False,
            )
            license_id = _prompt_value("License (optional)", tag_map.get("license", [None])[0], required=False)
            authors = _prompt_value(
                "Authors (npub or hex pubkey; comma-separated, optional)",
                _format_list_default(tag_map.get("authors")),
                required=False,
            )
            try:
                authors_list = _validate_author_keys(_parse_list_value(authors))
            except ValueError as exc:
                print(f"Error: {exc}")
                continue
            content = content.replace("# Title", f"# {title_value}", 1)
            tags = _ncc_tags_from_inputs(
                summary=_normalize_optional_str(summary),
                topics=_parse_list_value(topics),
                lang=_normalize_optional_str(lang),
                version=_normalize_optional_str(version),
                supersedes=_parse_list_value(supersedes),
                license_id=_normalize_optional_str(license_id),
                authors=authors_list,
            )
            conn = _db_connect(config_path)
            _db_update_draft(
                conn,
                draft_id=int(draft["id"]),
                title=title_value,
                content=content,
                tags=tags,
            )
            conn.close()
            export_path = _prompt_value("Export JSON path (optional)", default=None, required=False)
            if export_path:
                payload = _payload_from_draft(30050, d_value, title_value, content, tags, _now())
                _write_json(export_path, payload)
                print(f"Wrote NCC draft JSON to {export_path}")
            print("Updated NCC draft in database.")
            continue

        if command == "/revise-nsr":
            d_value = _prompt_value("NCC number (e.g. 01)", required=True)
            d_value = _format_ncc_identifier(d_value)
            if not d_value:
                print("Cancelled.")
                continue
            config_path = _default_config_path()
            conn = _db_connect(config_path)
            draft = _db_get_latest_draft(conn, 30051, d_value)
            if not draft:
                conn.close()
                json_path = _prompt_value("Import JSON path (optional)", default=None, required=False)
                if not json_path:
                    print("Cancelled.")
                    continue
                payload = _load_json(json_path)
                tags = _tags_from_payload(payload)
                content_seed = payload.get("content", "")
                conn = _db_connect(config_path)
                draft_id = _db_insert_draft(
                    conn,
                    kind=30051,
                    d=d_value,
                    title=None,
                    content=content_seed,
                    tags=tags,
                )
                conn.close()
                draft = {"id": draft_id, "content": content_seed}
            else:
                tags = _db_get_tags(conn, draft["id"])
                conn.close()
            tag_map = _tags_to_map(tags)
            authoritative_event = _prompt_value(
                "Authoritative event id",
                _strip_event_prefix(tag_map.get("authoritative", [None])[0]),
                required=True,
            )
            default_content_path = _default_ncc_content_path(d_value)
            content_path = _prompt_value("Content path", default_content_path, required=True)
            _write_text_file(content_path, draft["content"] or "Steward acknowledges updated NCC document.")
            open_now = _prompt_value("Open editor now? (y/n)", "y", required=False)
            if _is_truthy_response(open_now):
                _open_in_editor(content_path)
            content = _load_content_from_path(content_path)
            steward = _prompt_value("Steward (optional)", tag_map.get("steward", [None])[0], required=False)
            previous = _prompt_value(
                "Previous event id (optional)",
                _strip_event_prefix(tag_map.get("previous", [None])[0]),
                required=False,
            )
            reason = _prompt_value("Reason (optional)", tag_map.get("reason", [None])[0], required=False)
            effective_at = _prompt_value(
                "Effective at (optional)",
                tag_map.get("effective_at", [None])[0],
                required=False,
            )
            tags = _nsr_tags_from_inputs(
                authoritative_event=authoritative_event,
                steward=_normalize_optional_str(steward),
                previous=_normalize_optional_str(previous),
                reason=_normalize_optional_str(reason),
                effective_at=_normalize_optional_str(effective_at),
            )
            conn = _db_connect(config_path)
            _db_update_draft(
                conn,
                draft_id=int(draft["id"]),
                title=None,
                content=content,
                tags=tags,
            )
            conn.close()
            export_path = _prompt_value("Export JSON path (optional)", default=None, required=False)
            if export_path:
                payload = _payload_from_draft(30051, d_value, None, content, tags, _now())
                _write_json(export_path, payload)
                print(f"Wrote succession record JSON to {export_path}")
            print("Updated succession record in database.")
            continue

        if command == "/create-nsr":
            default_path = _default_config_path()
            config_path = default_path
            config = _load_config_db(config_path)
            config_tags = config.get("tags", {}) if isinstance(config, dict) else {}
            d_value = _prompt_value("NCC number (e.g. 01)", required=True)
            d_value = _format_ncc_identifier(d_value)
            authoritative_event = _prompt_value("Authoritative event id", required=True)
            content_value = _prompt_value(
                "Content",
                "Steward acknowledges updated NCC document.",
                required=True,
            )
            tags = _nsr_tags_from_inputs(
                authoritative_event=authoritative_event,
                steward=_normalize_optional_str(config_tags.get("steward")),
                previous=_normalize_optional_str(config_tags.get("previous")),
                reason=_normalize_optional_str(config_tags.get("reason")),
                effective_at=_normalize_optional_str(config_tags.get("effective_at")),
            )
            conn = _db_connect(config_path)
            draft_id = _db_insert_draft(
                conn,
                kind=30051,
                d=d_value,
                title=None,
                content=content_value,
                tags=tags,
            )
            conn.close()
            export_path = _prompt_value("Export JSON path (optional)", default=None, required=False)
            if export_path:
                payload = _payload_from_draft(30051, d_value, None, content_value, tags, _now())
                _write_json(export_path, payload)
                print(f"Wrote succession record JSON to {export_path}")
            print(f"Saved succession record to database (id {draft_id}).")
            continue

        if command in ("/list-ncc", "/list-nsr"):
            kind = 30050 if command == "/list-ncc" else 30051
            config_path = _default_config_path()
            conn = _db_connect(config_path)
            rows = _db_list_drafts(conn, kind)
            conn.close()
            label = "NCC drafts" if kind == 30050 else "NSR drafts"
            print(f"{label}:")
            if not rows:
                print("  (none)")
                continue
            for row in rows:
                title = row["title"] or "-"
                updated_at = _format_ts(row["updated_at"])
                status = row["status"] or "draft"
                published_at = _format_ts(row["published_at"])
                print(f"  #{row['id']} {row['d']} {title} | {status} | updated {updated_at} | published {published_at}")
            continue

        if command in ("/publish-ncc", "/publish-nsr"):
            d_value = _prompt_value("NCC number (e.g. 01)", required=True)
            d_value = _format_ncc_identifier(d_value)
            if not d_value:
                print("Cancelled.")
                continue
            kind = 30050 if command == "/publish-ncc" else 30051
            config_path = _default_config_path()
            config = _load_config_db(config_path)
            relays = _prompt_list(
                "Relays",
                config.get("relays") if isinstance(config, dict) else None,
            )
            privkey = _prompt_value(
                "Privkey (nsec or hex, used for signing)",
                config.get("privkey") if isinstance(config, dict) else None,
                required=True,
            )
            keys = Keys.parse(privkey)
            conn = _db_connect(config_path)
            draft = _db_get_latest_draft(conn, kind, d_value)
            if not draft:
                conn.close()
                json_path = _prompt_value("JSON path (optional)", default=None, required=False)
                if not json_path:
                    print("Cancelled.")
                    continue
                print("Publishing event...")
                try:
                    with _PUBLISH_LOCK:
                        _attempt_publish_json(json_path, relays=relays, keys=keys)
                except Exception as exc:
                    _enqueue_publish_task(
                        {
                            "type": "json",
                            "config_path": config_path,
                            "json_path": json_path,
                            "relays": relays,
                        }
                    )
                    print(f"Publish failed: {exc}. Queued for retry.")
                continue
            tags = _db_get_tags(conn, draft["id"])
            conn.close()
            payload = _payload_from_draft(draft["kind"], draft["d"], draft["title"], draft["content"], tags, _now())
            print("Publishing event...")
            try:
                with _PUBLISH_LOCK:
                    event_id = _attempt_publish_payload(payload, relays=relays, keys=keys)
            except Exception as exc:
                _enqueue_publish_task(
                    {
                        "type": "draft",
                        "config_path": config_path,
                        "draft_id": int(draft["id"]),
                        "relays": relays,
                    }
                )
                print(f"Publish failed: {exc}. Queued for retry.")
                continue
            published_at = _now() if draft["kind"] == 30050 else None
            tags = _add_or_replace_tag(tags, "eventid", event_id)
            if published_at is not None:
                tags = _add_or_replace_tag(tags, "published_at", str(published_at))
            conn = _db_connect(config_path)
            _db_update_draft(
                conn,
                draft_id=int(draft["id"]),
                title=draft["title"],
                content=draft["content"],
                tags=tags,
                status="published",
                published_at=published_at,
                event_id=event_id,
            )
            conn.close()
            continue

        print("Error: unknown command. Type /help for options.")


def _interactive_tui() -> None:
    try:
        from prompt_toolkit.application import Application, run_in_terminal
        from prompt_toolkit.buffer import Buffer
        from prompt_toolkit.key_binding import KeyBindings
        from prompt_toolkit.layout import HSplit, Layout, Window
        from prompt_toolkit.layout.containers import VerticalAlign
        from prompt_toolkit.layout.dimension import Dimension
        from prompt_toolkit.widgets import TextArea
        from prompt_toolkit.layout.controls import BufferControl, FormattedTextControl
        from prompt_toolkit.layout.margins import ScrollbarMargin
        from prompt_toolkit.layout.menus import CompletionsMenu
        from prompt_toolkit.formatted_text import FormattedText
        from prompt_toolkit.lexers import Lexer
        from prompt_toolkit.application.current import get_app_or_none
        from prompt_toolkit.styles import Style
    except Exception:
        _interactive_cli()
        return

    separator_line = "-" * 72
    command_meta = {
        "/init-config": "Initialize default config in the database.",
        "/edit-config": "Edit config stored in the database (prompted).",
        "/create-ncc": "Create a draft NCC JSON file.",
        "/create-nsr": "Create a draft succession record JSON file.",
        "/revise-ncc": "Revise an existing NCC draft JSON file.",
        "/revise-nsr": "Revise an existing succession record JSON file.",
        "/list-ncc": "List NCC drafts in the database.",
        "/list-nsr": "List succession record drafts in the database.",
        "/publish-ncc": "Publish the latest NCC draft JSON file.",
        "/publish-nsr": "Publish the latest succession record JSON file.",
        "/help": "Show available commands.",
        "/quit": "Exit interactive mode.",
    }
    commands = list(command_meta)
    completer = _CommandCompleter(commands, meta=command_meta)

    class _OutputLexer(Lexer):
        def lex_document(self, document):
            def get_line(lineno: int):
                line = document.lines[lineno]
                prev_line = document.lines[lineno - 1] if lineno > 0 else ""
                next_line = (
                    document.lines[lineno + 1] if lineno + 1 < len(document.lines) else ""
                )
                app = get_app_or_none()
                width = app.output.get_size().columns if app else 0
                if line.startswith("> "):
                    return [("class:command-line", _pad_to_width(line, width))]
                if line == "" and (prev_line.startswith("> ") or next_line.startswith("> ")):
                    return [("class:command-line", " " * max(width, 0))]
                if line.startswith("Error:"):
                    return [("class:error-line", line)]
                if line.endswith(":") or line.endswith("):"):
                    return [("class:prompt-line", line)]
                if line.endswith(":") and line.isupper():
                    return [("class:section-line", line)]
                if line in ("Commands:", "Details:", "Getting started:"):
                    return [("class:section-line", line)]
                return [("", line)]

            return get_line

    output_lines: List[str] = []
    output_buffer = Buffer()
    app = None

    def append_line(text: str = "") -> None:
        output_lines.append(text)
        output_buffer.text = "\n".join(output_lines)
        output_buffer.cursor_position = len(output_buffer.text)
        output_buffer.selection_state = None

    def append_command(text: str) -> None:
        append_line("")
        append_line(f"> {text}")
        append_line("")

    def set_completer(enabled: bool) -> None:
        input_field.completer = completer if enabled else None

    def format_prompt(label: str, default: Optional[str]) -> str:
        if default:
            return f"{label} [{default}]:"
        return f"{label}:"

    flow: dict = {"steps": [], "index": 0, "answers": {}, "on_complete": None, "mode": None}

    def start_flow(steps: List[dict], on_complete: Callable[[dict], None]) -> None:
        flow["steps"] = steps
        flow["index"] = 0
        flow["answers"] = {}
        flow["on_complete"] = on_complete
        set_completer(False)
        step = flow["steps"][0]
        set_input_placeholder(step.get("default"))
        append_line(format_prompt(step["label"], step.get("default")))

    def run_editor(path: str) -> None:
        try:
            run_in_terminal(lambda: _open_in_editor(path))
        except Exception:
            _open_in_editor(path)

    def restart_flow(steps: List[dict], on_complete: Callable[[dict], None], mode: Optional[str], answers: dict) -> None:
        flow["steps"] = steps
        flow["index"] = 0
        flow["answers"] = answers
        flow["on_complete"] = on_complete
        flow["mode"] = mode
        set_completer(False)
        step = flow["steps"][0]
        set_input_placeholder(step.get("default"))
        append_line(format_prompt(step["label"], step.get("default")))

    def handle_flow_input(value: str) -> None:
        step = flow["steps"][flow["index"]]
        default = step.get("default")
        required = step.get("required", False)
        if value == "" and default is not None:
            value = default
        if required and not value:
            append_line("Value is required.")
            append_line(format_prompt(step["label"], default))
            return
        if step.get("key") == "authors":
            try:
                _validate_author_keys(_parse_list_value(value))
            except ValueError as exc:
                append_line(f"Error: {exc}")
                append_line(format_prompt(step["label"], default))
                return
        if flow.get("mode") in ("revise-ncc", "revise-nsr") and step.get("key") == "d":
            identifier = _format_ncc_identifier(value)
            if not identifier:
                append_line("Cancelled.")
                flow["steps"] = []
                flow["on_complete"] = None
                flow["mode"] = None
                set_completer(True)
                set_input_placeholder(None)
                return
            kind = 30050 if flow.get("mode") == "revise-ncc" else 30051
            config_path = _default_config_path()
            conn = _db_connect(config_path)
            draft = _db_get_latest_draft(conn, kind, identifier)
            if not draft:
                conn.close()
                flow["steps"] = [
                    {
                        "key": "json_path",
                        "label": "Import JSON path (optional)",
                        "default": None,
                        "required": False,
                    }
                ]
                flow["index"] = 0
                flow["answers"] = {"d": identifier, "config_path": config_path}
                flow["mode"] = "revise-ncc-path" if kind == 30050 else "revise-nsr-path"
                step = flow["steps"][0]
                set_input_placeholder(step.get("default"))
                append_line(format_prompt(step["label"], step.get("default")))
                return
            tags = _db_get_tags(conn, draft["id"])
            conn.close()
            tag_map = _tags_to_map(tags)
            if kind == 30050:
                steps = [
                    {"key": "title", "label": "Title", "default": draft["title"], "required": True},
                    {"key": "content_path", "label": "Content path", "default": None, "required": True},
                    {"key": "open_editor", "label": "Open editor now? (y/n)", "default": "y", "required": False},
                    {
                        "key": "summary",
                        "label": "Summary (optional)",
                        "default": tag_map.get("summary", [None])[0],
                        "required": False,
                    },
                    {
                        "key": "topics",
                        "label": "Topics (comma-separated, optional)",
                        "default": _format_list_default(tag_map.get("t")),
                        "required": False,
                    },
                    {"key": "lang", "label": "Lang (optional)", "default": tag_map.get("lang", [None])[0], "required": False},
                    {
                        "key": "version",
                        "label": "Version (optional)",
                        "default": tag_map.get("version", [None])[0],
                        "required": False,
                    },
                    {
                        "key": "supersedes",
                        "label": "Supersedes (optional)",
                        "default": _format_list_default(tag_map.get("supersedes")),
                        "required": False,
                    },
                    {
                        "key": "license",
                        "label": "License (optional)",
                        "default": tag_map.get("license", [None])[0],
                        "required": False,
                    },
                    {
                        "key": "authors",
                        "label": "Authors (npub or hex pubkey; comma-separated, optional)",
                        "default": _format_list_default(tag_map.get("authors")),
                        "required": False,
                    },
                    {"key": "out_path", "label": "Export JSON path (optional)", "default": None, "required": False},
                ]
                restart_flow(
                    steps,
                    flow["on_complete"],
                    "revise-ncc-edit",
                    {
                        "d": identifier,
                        "draft_id": draft["id"],
                        "content_seed": draft["content"] or "",
                        "config_path": config_path,
                    },
                )
                return
            steps = [
                {
                    "key": "authoritative_event",
                    "label": "Authoritative event id",
                    "default": _strip_event_prefix(tag_map.get("authoritative", [None])[0]),
                    "required": True,
                },
                {"key": "content_path", "label": "Content path", "default": None, "required": True},
                {"key": "open_editor", "label": "Open editor now? (y/n)", "default": "y", "required": False},
                {
                    "key": "steward",
                    "label": "Steward (optional)",
                    "default": tag_map.get("steward", [None])[0],
                    "required": False,
                },
                {
                    "key": "previous",
                    "label": "Previous event id (optional)",
                    "default": _strip_event_prefix(tag_map.get("previous", [None])[0]),
                    "required": False,
                },
                {
                    "key": "reason",
                    "label": "Reason (optional)",
                    "default": tag_map.get("reason", [None])[0],
                    "required": False,
                },
                {
                    "key": "effective_at",
                    "label": "Effective at (optional)",
                    "default": tag_map.get("effective_at", [None])[0],
                    "required": False,
                },
                {"key": "out_path", "label": "Export JSON path (optional)", "default": None, "required": False},
            ]
            restart_flow(
                steps,
                flow["on_complete"],
                "revise-nsr-edit",
                {
                    "d": identifier,
                    "draft_id": draft["id"],
                    "content_seed": draft["content"] or "",
                    "config_path": config_path,
                },
            )
            return
        if flow.get("mode") in ("publish-ncc", "publish-nsr") and step.get("key") == "d":
            identifier = _format_ncc_identifier(value)
            if not identifier:
                append_line("Cancelled.")
                flow["steps"] = []
                flow["on_complete"] = None
                flow["mode"] = None
                set_completer(True)
                set_input_placeholder(None)
                return
            kind = 30050 if flow.get("mode") == "publish-ncc" else 30051
            config_path = _default_config_path()
            conn = _db_connect(config_path)
            draft = _db_get_latest_draft(conn, kind, identifier)
            conn.close()
            if not draft:
                flow["steps"] = [
                    {
                        "key": "json_path",
                        "label": "JSON path (optional)",
                        "default": None,
                        "required": False,
                    }
                ]
                flow["index"] = 0
                flow["answers"] = {"d": identifier}
                flow["mode"] = "publish-ncc-path" if kind == 30050 else "publish-nsr-path"
                step = flow["steps"][0]
                set_input_placeholder(step.get("default"))
                append_line(format_prompt(step["label"], step.get("default")))
                return
            config_defaults = _load_config_db(config_path)
            restart_flow(
                [
                    {
                        "key": "relays",
                        "label": "Relays (comma-separated)",
                        "default": _format_list_default(config_defaults.get("relays")),
                        "required": False,
                    },
                    {
                        "key": "privkey",
                        "label": "Privkey (nsec or hex, used for signing)",
                        "default": config_defaults.get("privkey") or "",
                        "required": True,
                    },
                ],
                flow["on_complete"],
                flow["mode"],
                {"d": identifier, "draft_id": draft["id"]},
            )
            return
        if flow.get("mode") in ("revise-ncc-path", "revise-nsr-path") and step.get("key") == "json_path":
            if not value:
                append_line("Cancelled.")
                flow["steps"] = []
                flow["on_complete"] = None
                flow["mode"] = None
                set_completer(True)
                set_input_placeholder(None)
                return
            payload = _load_json(value)
            kind = 30050 if flow.get("mode") == "revise-ncc-path" else 30051
            identifier = flow["answers"].get("d") or ""
            tags = _tags_from_payload(payload)
            title = None
            if kind == 30050:
                title = _extract_tag_value(payload.get("tags", []), "title")
            content = payload.get("content", "") if isinstance(payload, dict) else ""
            config_path = flow["answers"].get("config_path") or _default_config_path()
            conn = _db_connect(config_path)
            draft_id = _db_insert_draft(
                conn,
                kind=kind,
                d=identifier,
                title=title,
                content=content,
                tags=tags,
            )
            conn.close()
            tag_map = _tags_to_map(tags)
            if kind == 30050:
                steps = [
                    {"key": "title", "label": "Title", "default": title, "required": True},
                    {"key": "content_path", "label": "Content path", "default": None, "required": True},
                    {"key": "open_editor", "label": "Open editor now? (y/n)", "default": "y", "required": False},
                    {
                        "key": "summary",
                        "label": "Summary (optional)",
                        "default": tag_map.get("summary", [None])[0],
                        "required": False,
                    },
                    {
                        "key": "topics",
                        "label": "Topics (comma-separated, optional)",
                        "default": _format_list_default(tag_map.get("t")),
                        "required": False,
                    },
                    {"key": "lang", "label": "Lang (optional)", "default": tag_map.get("lang", [None])[0], "required": False},
                    {
                        "key": "version",
                        "label": "Version (optional)",
                        "default": tag_map.get("version", [None])[0],
                        "required": False,
                    },
                    {
                        "key": "supersedes",
                        "label": "Supersedes (optional)",
                        "default": _format_list_default(tag_map.get("supersedes")),
                        "required": False,
                    },
                    {
                        "key": "license",
                        "label": "License (optional)",
                        "default": tag_map.get("license", [None])[0],
                        "required": False,
                    },
                    {
                        "key": "authors",
                        "label": "Authors (npub or hex pubkey; comma-separated, optional)",
                        "default": _format_list_default(tag_map.get("authors")),
                        "required": False,
                    },
                    {"key": "out_path", "label": "Export JSON path (optional)", "default": None, "required": False},
                ]
                restart_flow(
                    steps,
                    flow["on_complete"],
                    "revise-ncc-edit",
                    {
                        "d": identifier,
                        "draft_id": draft_id,
                        "content_seed": content,
                        "config_path": config_path,
                    },
                )
                return
            steps = [
                {
                    "key": "authoritative_event",
                    "label": "Authoritative event id",
                    "default": _strip_event_prefix(tag_map.get("authoritative", [None])[0]),
                    "required": True,
                },
                {"key": "content_path", "label": "Content path", "default": None, "required": True},
                {"key": "open_editor", "label": "Open editor now? (y/n)", "default": "y", "required": False},
                {
                    "key": "steward",
                    "label": "Steward (optional)",
                    "default": tag_map.get("steward", [None])[0],
                    "required": False,
                },
                {
                    "key": "previous",
                    "label": "Previous event id (optional)",
                    "default": _strip_event_prefix(tag_map.get("previous", [None])[0]),
                    "required": False,
                },
                {
                    "key": "reason",
                    "label": "Reason (optional)",
                    "default": tag_map.get("reason", [None])[0],
                    "required": False,
                },
                {
                    "key": "effective_at",
                    "label": "Effective at (optional)",
                    "default": tag_map.get("effective_at", [None])[0],
                    "required": False,
                },
                {"key": "out_path", "label": "Export JSON path (optional)", "default": None, "required": False},
            ]
            restart_flow(
                steps,
                flow["on_complete"],
                "revise-nsr-edit",
                {
                    "d": identifier,
                    "draft_id": draft_id,
                    "content_seed": content,
                    "config_path": config_path,
                },
            )
            return
        if flow.get("mode") in ("publish-ncc-path", "publish-nsr-path") and step.get("key") == "json_path":
            if not value:
                append_line("Cancelled.")
                flow["steps"] = []
                flow["on_complete"] = None
                flow["mode"] = None
                set_completer(True)
                set_input_placeholder(None)
                return
            flow["answers"]["json_path"] = value
            kind = 30050 if flow.get("mode") == "publish-ncc-path" else 30051
            flow_mode = "publish-ncc" if kind == 30050 else "publish-nsr"
            config_defaults = _load_config_db(_default_config_path())
            restart_flow(
                [
                    {"key": "json_path", "label": "JSON path", "default": value, "required": True},
                    {
                        "key": "relays",
                        "label": "Relays (comma-separated)",
                        "default": _format_list_default(config_defaults.get("relays")),
                        "required": False,
                    },
                    {
                        "key": "privkey",
                        "label": "Privkey (nsec or hex, used for signing)",
                        "default": config_defaults.get("privkey") or "",
                        "required": True,
                    },
                ],
                flow["on_complete"],
                flow_mode,
                flow["answers"],
            )
            return
        if flow.get("mode") in ("create-ncc", "create-nsr") and step.get("key") == "d":
            value = _format_ncc_identifier(value)
        if step.get("key") == "content_path":
            content_path = value
            seed = flow["answers"].get("content_seed")
            if seed is None:
                draft_id = flow["answers"].get("draft_id")
                if draft_id:
                    conn = _db_connect(flow["answers"].get("config_path"))
                    row = conn.execute("select content from drafts where id = ?", (int(draft_id),)).fetchone()
                    conn.close()
                    if row and row["content"] is not None:
                        seed = row["content"]
                        flow["answers"]["content_seed"] = seed
            if seed is not None:
                _write_text_file(content_path, seed)
            elif not os.path.exists(content_path):
                _write_text_file(content_path, _ncc_template_content())
            flow["answers"]["content_path"] = content_path
        if step.get("key") == "open_editor":
            open_now = _is_truthy_response(value) if value else True
            content_path = flow["answers"].get("content_path")
            if open_now and content_path:
                append_line("Opening editor...")
                run_editor(content_path)
            if content_path:
                flow["answers"]["content"] = _load_content_from_path(content_path)
        if step.get("key") == "config_path":
            config = _load_config_db(value) if value else {}
            if isinstance(config, dict):
                relays_default = _format_list_default(config.get("relays")) or None
                privkey_default = config.get("privkey") or None
            else:
                relays_default = None
                privkey_default = None
            for flow_step in flow["steps"]:
                if flow_step.get("key") == "relays":
                    flow_step["default"] = relays_default
                if flow_step.get("key") == "privkey":
                    flow_step["default"] = privkey_default
        flow["answers"][step["key"]] = value
        flow["index"] += 1
        if flow["index"] >= len(flow["steps"]):
            on_complete = flow["on_complete"]
            flow["steps"] = []
            flow["on_complete"] = None
            flow["mode"] = None
            set_completer(True)
            set_input_placeholder(None)
            if on_complete:
                on_complete(flow["answers"])
            return
        next_step = flow["steps"][flow["index"]]
        if flow.get("mode") == "create-ncc" and next_step.get("key") == "out_path":
            if next_step.get("default") is None:
                published_at = flow["answers"].get("published_at")
                if published_at is None:
                    published_at = _now()
                    flow["answers"]["published_at"] = published_at
                identifier = flow["answers"].get("d") or "ncc"
                next_step["default"] = _default_ncc_output_path(identifier, published_at)
        if flow.get("mode") == "create-ncc" and next_step.get("key") == "content_path":
            if next_step.get("default") is None:
                identifier = flow["answers"].get("d") or "ncc"
                next_step["default"] = _default_ncc_content_path(identifier)
        if flow.get("mode") in ("revise-ncc-edit", "revise-nsr-edit") and next_step.get("key") == "content_path":
            if next_step.get("default") is None:
                identifier = flow["answers"].get("d") or "ncc"
                next_step["default"] = _default_ncc_content_path(identifier)
        set_input_placeholder(next_step.get("default"))
        append_line(format_prompt(next_step["label"], next_step.get("default")))

    def handle_command(command: str) -> None:
        if command in ("/quit", "/exit"):
            app.exit()
            return

        if command in ("/help", "?"):
            append_line("Commands:")
            append_line("  /init-config")
            append_line("  /edit-config")
            append_line("  /create-ncc")
            append_line("  /create-nsr")
            append_line("  /revise-ncc")
            append_line("  /revise-nsr")
            append_line("  /list-ncc")
            append_line("  /list-nsr")
            append_line("  /publish-ncc")
            append_line("  /publish-nsr")
            append_line("  /quit")
            append_line("")
            append_line("Details:")
            append_line("  /init-config  Initialize default config in the database.")
            append_line("  /edit-config  Edit config stored in the database (prompted).")
            append_line("  /create-ncc   Create a draft NCC JSON file.")
            append_line("  /create-nsr   Create a draft succession record JSON file.")
            append_line("  /revise-ncc   Revise an existing NCC draft JSON file.")
            append_line("  /revise-nsr   Revise an existing succession record JSON file.")
            append_line("  /list-ncc     List NCC drafts in the database.")
            append_line("  /list-nsr     List succession record drafts in the database.")
            append_line("  /publish-ncc  Publish the latest NCC draft JSON file.")
            append_line("  /publish-nsr  Publish the latest succession record JSON file.")
            append_line("  /quit         Exit interactive mode.")
            append_line("")
            append_line("Getting started:")
            append_line("  1) /init-config")
            append_line("  2) /edit-config")
            append_line("  3) /create-ncc")
            append_line("  4) /publish-ncc")
            return

        if not command.startswith("/"):
            append_line("Error: commands must start with '/'. Type /help for options.")
            return

        if command == "/init-config":
            config_path = _default_config_path()
            if _config_exists(config_path):
                def _confirm_reset(answers: dict) -> None:
                    if not _is_truthy_response(answers.get("reset") or ""):
                        append_line("Config unchanged.")
                        return
                    _write_config_db(config_path, _default_config())
                    append_line(f"Initialized config in database at {config_path}")
                    start_flow(
                        [
                            {
                                "key": "configure",
                                "label": "Configure now? (y/n)",
                                "default": "y",
                                "required": False,
                            }
                        ],
                        lambda answers: handle_command("/edit-config") if _is_truthy_response(answers.get("configure") or "") else None,
                    )

                start_flow(
                    [
                        {
                            "key": "reset",
                            "label": "Config exists. Reset? (y/n)",
                            "default": "n",
                            "required": False,
                        }
                    ],
                    _confirm_reset,
                )
                return
            _write_config_db(config_path, _default_config())
            append_line(f"Initialized config in database at {config_path}")
            start_flow(
                [
                    {
                        "key": "configure",
                        "label": "Configure now? (y/n)",
                        "default": "y",
                        "required": False,
                    }
                ],
                lambda answers: handle_command("/edit-config") if _is_truthy_response(answers.get("configure") or "") else None,
            )
            return

        if command == "/edit-config":
            config_path = _default_config_path()
            if not _config_exists(config_path):
                _write_config_db(config_path, _default_config())
                append_line(f"Initialized config in database at {config_path}")
            config = _load_config_db(config_path) or _default_config()
            config_tags = config.get("tags", {}) if isinstance(config, dict) else {}
            steps = [
                {
                    "key": "privkey",
                    "label": "Privkey (nsec or hex, used for signing)",
                    "default": config.get("privkey") if isinstance(config, dict) else "",
                    "required": False,
                },
                {
                    "key": "relays",
                    "label": "Relays (comma-separated)",
                    "default": _format_list_default(config.get("relays")) if isinstance(config, dict) else "",
                    "required": False,
                },
                {"key": "summary", "label": "Summary (optional)", "default": config_tags.get("summary"), "required": False},
                {
                    "key": "topics",
                    "label": "Topics (comma-separated, optional)",
                    "default": _format_list_default(config_tags.get("topics")),
                    "required": False,
                },
                {"key": "lang", "label": "Lang (optional)", "default": config_tags.get("lang"), "required": False},
                {"key": "version", "label": "Version (optional)", "default": config_tags.get("version"), "required": False},
                {
                    "key": "supersedes",
                    "label": "Supersedes (optional)",
                    "default": _format_list_default(config_tags.get("supersedes")),
                    "required": False,
                },
                {"key": "license", "label": "License (optional)", "default": config_tags.get("license"), "required": False},
                {
                    "key": "authors",
                    "label": "Authors (npub or hex pubkey; comma-separated, optional)",
                    "default": _format_list_default(config_tags.get("authors")),
                    "required": False,
                },
                {"key": "steward", "label": "Steward (optional)", "default": config_tags.get("steward"), "required": False},
                {"key": "previous", "label": "Previous (optional)", "default": config_tags.get("previous"), "required": False},
                {"key": "reason", "label": "Reason (optional)", "default": config_tags.get("reason"), "required": False},
                {"key": "effective_at", "label": "Effective at (optional)", "default": config_tags.get("effective_at"), "required": False},
            ]

            def _complete_edit(answers: dict) -> None:
                privkey = answers.get("privkey") or ""
                if privkey:
                    try:
                        Keys.parse(privkey)
                    except Exception:
                        append_line("Error: privkey must be nsec or hex.")
                        return
                authors = _parse_list_value(answers.get("authors") or "")
                if authors:
                    try:
                        authors = _validate_author_keys(authors)
                    except ValueError as exc:
                        append_line(f"Error: {exc}")
                        return
                updated = {
                    "privkey": privkey,
                    "relays": _parse_list_value(answers.get("relays") or ""),
                    "tags": {
                        "summary": _normalize_optional_str(answers.get("summary")) or "",
                        "topics": _parse_list_value(answers.get("topics") or ""),
                        "lang": _normalize_optional_str(answers.get("lang")) or "",
                        "version": _normalize_optional_str(answers.get("version")) or "",
                        "supersedes": _parse_list_value(answers.get("supersedes") or ""),
                        "license": _normalize_optional_str(answers.get("license")) or "",
                        "authors": authors or [],
                        "steward": _normalize_optional_str(answers.get("steward")) or "",
                        "previous": _normalize_optional_str(answers.get("previous")) or "",
                        "reason": _normalize_optional_str(answers.get("reason")) or "",
                        "effective_at": _normalize_optional_str(answers.get("effective_at")) or "",
                    },
                }
                _write_config_db(config_path, updated)
                append_line(f"Updated config in database at {config_path}")

            start_flow(steps, _complete_edit)
            return

        if command == "/create-ncc":
            def _complete_create_ncc(answers: dict) -> None:
                config_path = _default_config_path()
                config = _load_config_db(config_path)
                config_tags = config.get("tags", {}) if isinstance(config, dict) else {}
                content_path = answers.get("content_path")
                if content_path and os.path.exists(content_path):
                    content = _load_content_from_path(content_path)
                else:
                    content = answers.get("content") or _ncc_template_content()
                content = content.replace("# Title", f"# {answers['title']}", 1)
                summary = _normalize_optional_str(answers.get("summary")) or config_tags.get("summary")
                lang = _normalize_optional_str(answers.get("lang")) or config_tags.get("lang")
                version = _normalize_optional_str(answers.get("version")) or config_tags.get("version")
                supersedes = _normalize_optional_str(answers.get("supersedes")) or config_tags.get("supersedes")
                license_id = _normalize_optional_str(answers.get("license")) or config_tags.get("license")
                topics = _parse_list_value(answers.get("topics") or "")
                authors = _parse_list_value(answers.get("authors") or "")
                if not topics:
                    topics = config_tags.get("topics")
                if not authors:
                    authors = config_tags.get("authors")
                try:
                    authors = _validate_author_keys(authors or [])
                except ValueError as exc:
                    append_line(f"Error: {exc}")
                    return
                tags = _ncc_tags_from_inputs(
                    summary=summary,
                    topics=topics or [],
                    lang=lang,
                    version=version,
                    supersedes=_parse_list_value(supersedes or "") if isinstance(supersedes, str) else (supersedes or []),
                    license_id=license_id,
                    authors=authors or [],
                )
                conn = _db_connect(config_path)
                draft_id = _db_insert_draft(
                    conn,
                    kind=30050,
                    d=answers["d"],
                    title=answers["title"],
                    content=content,
                    tags=tags,
                )
                conn.close()
                export_path = _normalize_optional_str(answers.get("out_path"))
                if export_path:
                    payload = _payload_from_draft(
                        30050,
                        answers["d"],
                        answers["title"],
                        content,
                        tags,
                        _now(),
                    )
                    _write_json(export_path, payload)
                    append_line(f"Wrote NCC draft JSON to {export_path}")
                append_line(f"Saved NCC draft to database (id {draft_id}).")

            default_path = _default_config_path()
            config = _load_config_db(default_path)
            config_tags = config.get("tags", {}) if isinstance(config, dict) else {}
            steps = [
                {"key": "d", "label": "NCC number (e.g. 01)", "default": None, "required": True},
                {"key": "title", "label": "Title", "default": None, "required": True},
                {"key": "content_path", "label": "Content path", "default": None, "required": True},
                {"key": "open_editor", "label": "Open editor now? (y/n)", "default": "y", "required": False},
                {"key": "summary", "label": "Summary (optional)", "default": config_tags.get("summary"), "required": False},
                {
                    "key": "topics",
                    "label": "Topics (comma-separated, optional)",
                    "default": _format_list_default(config_tags.get("topics")),
                    "required": False,
                },
            ]
            steps.extend(
                [
                    {"key": "lang", "label": "Lang (optional)", "default": config_tags.get("lang"), "required": False},
                    {"key": "version", "label": "Version (optional)", "default": config_tags.get("version"), "required": False},
                    {
                        "key": "supersedes",
                        "label": "Supersedes (optional)",
                        "default": config_tags.get("supersedes"),
                        "required": False,
                    },
                    {"key": "license", "label": "License (optional)", "default": config_tags.get("license"), "required": False},
                    {
                        "key": "authors",
                        "label": "Authors (npub or hex pubkey; comma-separated, optional)",
                        "default": _format_list_default(config_tags.get("authors")),
                        "required": False,
                    },
                    {"key": "out_path", "label": "Export JSON path (optional)", "default": None, "required": False},
                ]
            )
            flow["mode"] = "create-ncc"
            start_flow(steps, _complete_create_ncc)
            return

        if command == "/revise-ncc":
            def _complete_revise_ncc(answers: dict) -> None:
                content_path = answers.get("content_path")
                if content_path and os.path.exists(content_path):
                    content = _load_content_from_path(content_path)
                else:
                    content = answers.get("content") or _ncc_template_content()
                content = content.replace("# Title", f"# {answers['title']}", 1)
                try:
                    authors = _validate_author_keys(_parse_list_value(answers.get("authors") or ""))
                except ValueError as exc:
                    append_line(f"Error: {exc}")
                    return
                tags = _ncc_tags_from_inputs(
                    summary=_normalize_optional_str(answers.get("summary")),
                    topics=_parse_list_value(answers.get("topics") or ""),
                    lang=_normalize_optional_str(answers.get("lang")),
                    version=_normalize_optional_str(answers.get("version")),
                    supersedes=_parse_list_value(answers.get("supersedes") or ""),
                    license_id=_normalize_optional_str(answers.get("license")),
                    authors=authors,
                )
                conn = _db_connect(answers.get("config_path") or _default_config_path())
                _db_update_draft(
                    conn,
                    draft_id=int(answers["draft_id"]),
                    title=answers["title"],
                    content=content,
                    tags=tags,
                )
                conn.close()
                export_path = _normalize_optional_str(answers.get("out_path"))
                if export_path:
                    payload = _payload_from_draft(30050, answers["d"], answers["title"], content, tags, _now())
                    _write_json(export_path, payload)
                    append_line(f"Wrote NCC draft JSON to {export_path}")
                append_line("Updated NCC draft in database.")
            steps = [
                {"key": "d", "label": "NCC number (e.g. 01)", "default": None, "required": True},
            ]
            flow["mode"] = "revise-ncc"
            start_flow(steps, _complete_revise_ncc)
            return

        if command == "/revise-nsr":
            def _complete_revise_nsr(answers: dict) -> None:
                content_path = answers.get("content_path")
                if content_path and os.path.exists(content_path):
                    content = _load_content_from_path(content_path)
                else:
                    content = answers.get("content") or "Steward acknowledges updated NCC document."
                tags = _nsr_tags_from_inputs(
                    authoritative_event=answers["authoritative_event"],
                    steward=_normalize_optional_str(answers.get("steward")),
                    previous=_normalize_optional_str(answers.get("previous")),
                    reason=_normalize_optional_str(answers.get("reason")),
                    effective_at=_normalize_optional_str(answers.get("effective_at")),
                )
                conn = _db_connect(answers.get("config_path") or _default_config_path())
                _db_update_draft(
                    conn,
                    draft_id=int(answers["draft_id"]),
                    title=None,
                    content=content,
                    tags=tags,
                )
                conn.close()
                export_path = _normalize_optional_str(answers.get("out_path"))
                if export_path:
                    payload = _payload_from_draft(30051, answers["d"], None, content, tags, _now())
                    _write_json(export_path, payload)
                    append_line(f"Wrote succession record JSON to {export_path}")
                append_line("Updated succession record in database.")
            steps = [
                {"key": "d", "label": "NCC number (e.g. 01)", "default": None, "required": True},
            ]
            flow["mode"] = "revise-nsr"
            start_flow(steps, _complete_revise_nsr)
            return

        if command == "/create-nsr":
            def _complete_create_nsr(answers: dict) -> None:
                config_path = _default_config_path()
                config = _load_config_db(config_path)
                config_tags = config.get("tags", {}) if isinstance(config, dict) else {}
                content = answers.get("content") or "Steward acknowledges updated NCC document."
                tags = _nsr_tags_from_inputs(
                    authoritative_event=answers["authoritative_event"],
                    steward=_normalize_optional_str(config_tags.get("steward")),
                    previous=_normalize_optional_str(config_tags.get("previous")),
                    reason=_normalize_optional_str(config_tags.get("reason")),
                    effective_at=_normalize_optional_str(config_tags.get("effective_at")),
                )
                conn = _db_connect(config_path)
                draft_id = _db_insert_draft(
                    conn,
                    kind=30051,
                    d=answers["d"],
                    title=None,
                    content=content,
                    tags=tags,
                )
                conn.close()
                export_path = _normalize_optional_str(answers.get("out_path"))
                if export_path:
                    payload = _payload_from_draft(30051, answers["d"], None, content, tags, _now())
                    _write_json(export_path, payload)
                    append_line(f"Wrote succession record JSON to {export_path}")
                append_line(f"Saved succession record to database (id {draft_id}).")

            steps = [
                {"key": "d", "label": "NCC number (e.g. 01)", "default": None, "required": True},
                {"key": "authoritative_event", "label": "Authoritative event id", "default": None, "required": True},
                {
                    "key": "content",
                    "label": "Content",
                    "default": "Steward acknowledges updated NCC document.",
                    "required": True,
                },
                {"key": "out_path", "label": "Export JSON path (optional)", "default": None, "required": False},
            ]
            flow["mode"] = "create-nsr"
            start_flow(steps, _complete_create_nsr)
            return

        if command in ("/list-ncc", "/list-nsr"):
            kind = 30050 if command == "/list-ncc" else 30051
            config_path = _default_config_path()
            conn = _db_connect(config_path)
            rows = _db_list_drafts(conn, kind)
            conn.close()
            label = "NCC drafts" if kind == 30050 else "NSR drafts"
            append_line(f"{label}:")
            if not rows:
                append_line("  (none)")
                return
            for row in rows:
                title = row["title"] or "-"
                updated_at = _format_ts(row["updated_at"])
                status = row["status"] or "draft"
                published_at = _format_ts(row["published_at"])
                append_line(f"  #{row['id']} {row['d']} {title} | {status} | updated {updated_at} | published {published_at}")
            return

        if command in ("/publish-ncc", "/publish-nsr"):
            def _complete_publish_latest(answers: dict) -> None:
                config_path = _default_config_path()
                config = _load_config_db(config_path)
                relays = _parse_list_value(answers["relays"])
                if not relays and isinstance(config, dict):
                    relays = config.get("relays", []) or []
                privkey = answers["privkey"] or (config.get("privkey") if isinstance(config, dict) else None)
                if not privkey:
                    append_line("Error: privkey is required.")
                    return
                keys = Keys.parse(privkey)
                draft_id = answers.get("draft_id")
                if draft_id:
                    append_line("Publishing event...")
                    try:
                        with _PUBLISH_LOCK:
                            _attempt_publish_draft(config_path, int(draft_id), relays=relays, keys=keys)
                    except Exception as exc:
                        _enqueue_publish_task(
                            {
                                "type": "draft",
                                "config_path": config_path,
                                "draft_id": int(draft_id),
                                "relays": relays,
                            }
                        )
                        append_line(f"Publish failed: {exc}. Queued for retry.")
                    return
                json_path = answers.get("json_path")
                if not json_path:
                    append_line("Error: JSON path is required.")
                    return
                append_line("Publishing event...")
                try:
                    with _PUBLISH_LOCK:
                        _attempt_publish_json(json_path, relays=relays, keys=keys)
                except Exception as exc:
                    _enqueue_publish_task(
                        {
                            "type": "json",
                            "config_path": config_path,
                            "json_path": json_path,
                            "relays": relays,
                        }
                    )
                    append_line(f"Publish failed: {exc}. Queued for retry.")

            flow["mode"] = "publish-ncc" if command == "/publish-ncc" else "publish-nsr"
            start_flow(
                [
                    {"key": "d", "label": "NCC number (e.g. 01)", "default": None, "required": True},
                ],
                _complete_publish_latest,
            )
            return

        append_line("Error: unknown command. Type /help for options.")

    output_window = Window(
        content=BufferControl(
            buffer=output_buffer,
            focusable=False,
            include_default_input_processors=False,
            lexer=_OutputLexer(),
        ),
        wrap_lines=True,
        always_hide_cursor=True,
        align=VerticalAlign.BOTTOM,
        height=Dimension(min=1, weight=1),
        right_margins=[ScrollbarMargin()],
        style="class:output-area",
    )
    input_field = TextArea(height=1, prompt="› ", multiline=False)
    input_field.buffer.completer = completer
    input_field.buffer.complete_while_typing = lambda: True
    base_placeholder = "Find and fix a bug in @filename"

    def set_input_placeholder(value: Optional[str]) -> None:
        text = value if value else base_placeholder
        try:
            input_field.placeholder = text
        except Exception:
            input_field.control.placeholder = FormattedText([("class:placeholder", text)])

    set_input_placeholder(None)

    input_window = Window(
        content=BufferControl(
            buffer=input_field.buffer,
            focusable=True,
            include_default_input_processors=True,
        ),
        height=1,
        style="class:input-area",
    )
    input_pad_top = Window(
        content=FormattedTextControl(" "),
        height=1,
        style="class:input-area",
    )
    input_pad_bottom = Window(
        content=FormattedTextControl(" "),
        height=1,
        style="class:input-area",
    )

    input_container = HSplit(
        [
            input_pad_top,
            input_window,
            input_pad_bottom,
        ],
        height=Dimension.exact(3),
    )

    root_container = HSplit(
        [
            output_window,
            CompletionsMenu(max_height=8),
            input_container,
        ]
    )

    layout = Layout(root_container, focused_element=input_window)
    kb = KeyBindings()

    @kb.add("enter")
    def _submit(event) -> None:
        text = input_field.text.strip()
        input_field.text = ""
        if text == "":
            if flow["steps"]:
                handle_flow_input("")
            return
        if flow["steps"]:
            append_line(f"> {text}")
            handle_flow_input(text)
        else:
            append_command(text)
            handle_command(text)

    @kb.add("c-c")
    @kb.add("c-d")
    def _exit(event) -> None:
        app.exit()

    @kb.add("tab")
    def _complete_next(event) -> None:
        event.app.current_buffer.complete_next()

    style = Style.from_dict(
        {
            "output-area": "bg:#2b2b2b #e0e0e0",
            "command-line": "bg:#3f3f3f #e0e0e0",
            "prompt-line": "fg:#9ad1ff",
            "section-line": "fg:#7fd1b9",
            "error-line": "fg:#ff8a8a",
            "input-area": "bg:#3f3f3f #e0e0e0",
            "placeholder": "fg:#b0b0b0",
            "completion-menu": "bg:#3a3a3a #e0e0e0",
            "completion-menu.completion": "bg:#3a3a3a #e0e0e0",
            "completion-menu.completion.current": "bg:#5a5a5a #e0e0e0",
            "scrollbar.background": "bg:#3a3a3a",
            "scrollbar.button": "bg:#5a5a5a",
        }
    )
    app = Application(layout=layout, key_bindings=kb, full_screen=True, style=style)

    append_line("NCC publisher")
    append_line("Type /help for commands.")
    append_line("")
    append_line(separator_line)
    _start_publish_queue_worker()
    app.run()


def _interactive() -> None:
    try:
        import prompt_toolkit  # noqa: F401
    except Exception:
        _interactive_cli()
        return
    _interactive_tui()


def _add_tag(tags: List[Tag], key: str, value: Optional[str]) -> None:
    if value:
        tags.append(Tag.parse([key, value]))


def _add_tag_many(tags: List[Tag], key: str, values: Optional[List[str]]) -> None:
    if not values:
        return
    for value in values:
        tags.append(Tag.parse([key, value]))


def _set_builder_created_at(builder: EventBuilder, created_at: Optional[int]) -> EventBuilder:
    if created_at is None:
        return builder
    if hasattr(builder, "created_at"):
        return builder.created_at(int(created_at))
    return builder.custom_created_at(int(created_at))


def _merge_optional(value: Optional[str], fallback: Optional[str]) -> Optional[str]:
    return value if value is not None else fallback


def _merge_optional_list(value: Optional[List[str]], fallback: Optional[List[str]]) -> Optional[List[str]]:
    if value is not None and len(value) > 0:
        return value
    return fallback


def _add_json_tag(tags: List[List[str]], key: str, value: Optional[str]) -> None:
    if value:
        tags.append([key, value])


def _add_json_tag_many(tags: List[List[str]], key: str, values: Optional[List[str]]) -> None:
    if not values:
        return
    for value in values:
        tags.append([key, value])


def _ncc_template_content() -> str:
    return (
        "# Title\n\n"
        "**Status:** Draft\n\n"
        "## Scope\n"
        "- What the convention applies to\n"
        "- What the convention does not cover\n\n"
        "## Standards or NIPs referenced\n"
        "- List any related NIPs\n\n"
        "## Overview\n"
        "- Problem statement and intent\n\n"
        "## Design principles\n"
        "- Constraints or values guiding the convention\n\n"
        "## Core approach\n"
        "- Behavioural or structural model being proposed\n\n"
        "## Event schema\n"
        "- Required fields/tags\n"
        "- Optional fields/tags\n\n"
        "## Examples\n"
        "- Representative examples\n\n"
        "## Client behaviour guidance\n"
        "- Expected handling by supporting clients\n\n"
        "## Privacy and security considerations\n"
        "- Metadata that remains visible\n"
        "- Metadata that does not\n\n"
        "## Non-goals\n"
        "- Explicit exclusions to prevent scope creep\n\n"
        "## FAQ or rationale\n"
        "- Optional clarifications\n\n"
        "## Status and next steps\n"
        "- Adoption expectations and future formalisation notes\n"
    )


def build_document_json(
    *,
    d: str,
    title: str,
    content: str,
    published_at: int,
    summary: Optional[str],
    topics: Optional[List[str]],
    lang: Optional[str],
    version: Optional[str],
    supersedes: Optional[List[str]],
    license_id: Optional[str],
    authors: Optional[List[str]],
) -> dict:
    tags: List[List[str]] = []
    tags.append(["d", d])
    tags.append(["title", title])
    tags.append(["published_at", str(published_at)])
    _add_json_tag(tags, "summary", summary)
    _add_json_tag_many(tags, "t", topics)
    _add_json_tag(tags, "lang", lang)
    _add_json_tag(tags, "version", version)
    _add_json_tag_many(tags, "supersedes", supersedes)
    _add_json_tag(tags, "license", license_id)
    _add_json_tag_many(tags, "authors", authors)

    return {
        "kind": 30050,
        "created_at": published_at,
        "tags": tags,
        "content": content,
    }


def build_succession_json(
    *,
    d: str,
    authoritative_event: str,
    content: str,
    created_at: int,
    steward: Optional[str],
    previous: Optional[str],
    reason: Optional[str],
    effective_at: Optional[int],
) -> dict:
    tags: List[List[str]] = []
    tags.append(["d", d])
    tags.append(["authoritative", f"event:{authoritative_event}"])
    _add_json_tag(tags, "steward", steward)
    _add_json_tag(tags, "previous", f"event:{previous}" if previous else None)
    _add_json_tag(tags, "reason", reason)
    _add_json_tag(tags, "effective_at", str(effective_at) if effective_at else None)

    return {
        "kind": 30051,
        "created_at": created_at,
        "tags": tags,
        "content": content,
    }


def build_document_event(
    *,
    d: str,
    title: str,
    content: str,
    published_at: int,
    summary: Optional[str],
    topics: Optional[List[str]],
    lang: Optional[str],
    version: Optional[str],
    supersedes: Optional[List[str]],
    license_id: Optional[str],
    authors: Optional[List[str]],
) -> EventBuilder:
    tags: List[Tag] = []
    tags.append(Tag.parse(["d", d]))
    tags.append(Tag.parse(["title", title]))
    tags.append(Tag.parse(["published_at", str(published_at)]))
    _add_tag(tags, "summary", summary)
    _add_tag_many(tags, "t", topics)
    _add_tag(tags, "lang", lang)
    _add_tag(tags, "version", version)
    _add_tag_many(tags, "supersedes", supersedes)
    _add_tag(tags, "license", license_id)
    _add_tag_many(tags, "authors", authors)

    builder = EventBuilder(Kind(30050), content).tags(tags)
    return _set_builder_created_at(builder, published_at)


def build_succession_event(
    *,
    d: str,
    authoritative_event: str,
    content: str,
    created_at: int,
    steward: Optional[str],
    previous: Optional[str],
    reason: Optional[str],
    effective_at: Optional[int],
) -> EventBuilder:
    tags: List[Tag] = []
    tags.append(Tag.parse(["d", d]))
    tags.append(Tag.parse(["authoritative", f"event:{authoritative_event}"]))
    _add_tag(tags, "steward", steward)
    _add_tag(tags, "previous", f"event:{previous}" if previous else None)
    _add_tag(tags, "reason", reason)
    _add_tag(tags, "effective_at", str(effective_at) if effective_at else None)

    builder = EventBuilder(Kind(30051), content).tags(tags)
    return _set_builder_created_at(builder, created_at)


async def publish_event(builder: EventBuilder, *, relays: List[str], keys: Keys) -> str:
    if not relays:
        raise SystemExit("At least one --relay is required to publish.")
    client = Client(keys)
    for relay in relays:
        await client.add_relay(relay)
    await client.connect()

    event = builder.to_event(keys)
    await client.send_event(event)
    await client.disconnect()

    event_id = event.id().to_hex()
    print(f"Published event kind={event.kind()} id={event_id}")
    return event_id


def build_event_from_json(payload: dict) -> EventBuilder:
    kind_value = payload.get("kind")
    if kind_value is None:
        raise SystemExit("JSON is missing required field: kind")
    content = payload.get("content", "")
    created_at = payload.get("created_at")
    tags_value = payload.get("tags", [])
    if not isinstance(tags_value, list):
        raise SystemExit("JSON field tags must be a list")

    tags: List[Tag] = []
    for tag in tags_value:
        if not isinstance(tag, list):
            raise SystemExit("Each tag must be a list")
        tags.append(Tag.parse(tag))

    builder = EventBuilder(Kind(int(kind_value)), content).tags(tags)
    return _set_builder_created_at(builder, created_at)


def _common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--config", default=_default_config_path(), help="config db path")
    parser.add_argument("--privkey", help="nsec or hex private key")
    parser.add_argument("--relay", action="append", help="relay url (repeatable)")


def main() -> None:
    parser = argparse.ArgumentParser(description="NCC publisher")
    subparsers = parser.add_subparsers(dest="command")

    init_cfg = subparsers.add_parser("init-config", help="initialize default config in the database")
    init_cfg.add_argument("--config", default=_default_config_path(), help="config db path")

    edit_cfg = subparsers.add_parser("edit-config", help="edit config stored in the database (prompted)")
    edit_cfg.add_argument("--config", default=_default_config_path(), help="config db path")

    subparsers.add_parser("interactive", help="interactive prompt-driven mode")

    create_ncc = subparsers.add_parser("create-ncc", help="create a draft NCC JSON file")
    create_ncc.add_argument("--config", default=_default_config_path(), help="config db path")
    create_ncc.add_argument("--out", help="output json path")

    create_nsr = subparsers.add_parser("create-nsr", help="create a succession record JSON file")
    create_nsr.add_argument("--config", default=_default_config_path(), help="config db path")
    create_nsr.add_argument("--out", help="output json path")

    doc = subparsers.add_parser("document", help="publish NCC document (kind 30050)")
    doc.add_argument("--d", required=True, help="NCC identifier, e.g. ncc-01")
    doc.add_argument("--title", required=True)
    doc.add_argument("--content", required=True)
    doc.add_argument("--published-at", type=int, default=_now())
    doc.add_argument("--summary")
    doc.add_argument("--topic", action="append")
    doc.add_argument("--lang")
    doc.add_argument("--version")
    doc.add_argument("--supersedes", action="append")
    doc.add_argument("--license")
    doc.add_argument("--authors", action="append")
    _common_args(doc)

    succ = subparsers.add_parser("succession", help="publish NCC succession (kind 30051)")
    succ.add_argument("--d", required=True, help="NCC identifier, e.g. ncc-01")
    succ.add_argument("--authoritative-event-id", required=True, dest="authoritative_event")
    succ.add_argument("--content", default="Steward acknowledges updated NCC document.")
    succ.add_argument("--created-at", type=int, default=_now())
    succ.add_argument("--steward")
    succ.add_argument("--previous")
    succ.add_argument("--reason")
    succ.add_argument("--effective-at", type=int)
    _common_args(succ)

    args = parser.parse_args()

    if args.command is None:
        _interactive()
        return

    if args.command == "init-config":
        _write_config_db(args.config, _default_config())
        print(f"Initialized config in database at {args.config}")
        return

    if args.command == "edit-config":
        if not _load_config_db(args.config):
            _write_config_db(args.config, _default_config())
        config = _load_config_db(args.config) or _default_config()
        relays = _prompt_list("Relays", config.get("relays") if isinstance(config, dict) else None)
        privkey = _prompt_value(
            "Privkey (nsec or hex, used for signing)",
            config.get("privkey") if isinstance(config, dict) else None,
            required=False,
        )
        if privkey:
            try:
                Keys.parse(privkey)
            except Exception:
                raise SystemExit("privkey must be nsec or hex.")
        tags = config.get("tags", {}) if isinstance(config, dict) else {}
        summary = _prompt_value("Summary (optional)", tags.get("summary"), required=False)
        topics = _prompt_value(
            "Topics (comma-separated, optional)",
            _format_list_default(tags.get("topics")),
            required=False,
        )
        lang = _prompt_value("Lang (optional)", tags.get("lang"), required=False)
        version = _prompt_value("Version (optional)", tags.get("version"), required=False)
        supersedes = _prompt_value("Supersedes (optional)", tags.get("supersedes"), required=False)
        license_id = _prompt_value("License (optional)", tags.get("license"), required=False)
        authors = _prompt_value(
            "Authors (npub or hex pubkey; comma-separated, optional)",
            _format_list_default(tags.get("authors")),
            required=False,
        )
        steward = _prompt_value("Steward (optional)", tags.get("steward"), required=False)
        previous = _prompt_value("Previous (optional)", tags.get("previous"), required=False)
        reason = _prompt_value("Reason (optional)", tags.get("reason"), required=False)
        effective_at = _prompt_value("Effective at (optional)", tags.get("effective_at"), required=False)
        authors_list = _parse_list_value(authors)
        if authors_list:
            authors_list = _validate_author_keys(authors_list)
        updated = {
            "privkey": privkey or "",
            "relays": relays or [],
            "tags": {
                "summary": _normalize_optional_str(summary) or "",
                "topics": _parse_list_value(topics) or [],
                "lang": _normalize_optional_str(lang) or "",
                "version": _normalize_optional_str(version) or "",
                "supersedes": _parse_list_value(supersedes) or [],
                "license": _normalize_optional_str(license_id) or "",
                "authors": authors_list or [],
                "steward": _normalize_optional_str(steward) or "",
                "previous": _normalize_optional_str(previous) or "",
                "reason": _normalize_optional_str(reason) or "",
                "effective_at": _normalize_optional_str(effective_at) or "",
            },
        }
        _write_config_db(args.config, updated)
        return

    if args.command == "interactive":
        _interactive()
        return

    if args.command == "create-ncc":
        config = _load_config_db(args.config)
        config_tags = config.get("tags", {}) if isinstance(config, dict) else {}
        d_value = input("NCC number (e.g. 01): ").strip()
        d_value = _format_ncc_identifier(d_value)
        if not d_value:
            raise SystemExit("NCC identifier is required")
        title_value = input("Title: ").strip()
        if not title_value:
            raise SystemExit("Title is required")
        default_content_path = _default_ncc_content_path(d_value)
        content_path = input(f"Content path [{default_content_path}]: ").strip() or default_content_path
        if not os.path.exists(content_path):
            _write_text_file(content_path, _ncc_template_content())
        open_now = input("Open editor now? [Y/n]: ").strip() or "y"
        if _is_truthy_response(open_now):
            _open_in_editor(content_path)
        content = _load_content_from_path(content_path)
        summary = input(f"Summary (optional) [{config_tags.get('summary') or ''}]: ").strip()
        topics_default = _format_list_default(config_tags.get("topics")) or ""
        topics = input(f"Topics (comma-separated, optional) [{topics_default}]: ").strip()
        lang = input(f"Lang (optional) [{config_tags.get('lang') or ''}]: ").strip()
        version = input(f"Version (optional) [{config_tags.get('version') or ''}]: ").strip()
        supersedes = input(f"Supersedes (optional) [{config_tags.get('supersedes') or ''}]: ").strip()
        license_id = input(f"License (optional) [{config_tags.get('license') or ''}]: ").strip()
        authors_default = _format_list_default(config_tags.get("authors")) or ""
        authors = input(f"Authors (npub or hex pubkey; comma-separated, optional) [{authors_default}]: ").strip()
        authors_list = _parse_list_value(authors) or config_tags.get("authors") or []
        try:
            authors_list = _validate_author_keys(authors_list)
        except ValueError as exc:
            raise SystemExit(str(exc))
        content = content.replace("# Title", f"# {title_value}", 1)
        tags = _ncc_tags_from_inputs(
            summary=_normalize_optional_str(summary) or config_tags.get("summary"),
            topics=_parse_list_value(topics) or config_tags.get("topics") or [],
            lang=_normalize_optional_str(lang) or config_tags.get("lang"),
            version=_normalize_optional_str(version) or config_tags.get("version"),
            supersedes=_parse_list_value(supersedes) or config_tags.get("supersedes") or [],
            license_id=_normalize_optional_str(license_id) or config_tags.get("license"),
            authors=authors_list,
        )
        conn = _db_connect(args.config)
        draft_id = _db_insert_draft(
            conn,
            kind=30050,
            d=d_value,
            title=title_value,
            content=content,
            tags=tags,
        )
        conn.close()
        export_path = args.out or input("Export JSON path (optional): ").strip() or None
        if export_path:
            payload = _payload_from_draft(30050, d_value, title_value, content, tags, _now())
            _write_json(export_path, payload)
            print(f"Wrote NCC draft JSON to {export_path}")
        print(f"Saved NCC draft to database (id {draft_id}).")
        return

    if args.command == "create-nsr":
        config = _load_config_db(args.config)
        config_tags = config.get("tags", {}) if isinstance(config, dict) else {}
        d_value = input("NCC number (e.g. 01): ").strip()
        d_value = _format_ncc_identifier(d_value)
        if not d_value:
            raise SystemExit("NCC identifier is required")
        authoritative_event = input("Authoritative event id: ").strip()
        if not authoritative_event:
            raise SystemExit("Authoritative event id is required")
        content_value = input(
            "Content [Steward acknowledges updated NCC document.]: "
        ).strip() or "Steward acknowledges updated NCC document."
        tags = _nsr_tags_from_inputs(
            authoritative_event=authoritative_event,
            steward=_normalize_optional_str(config_tags.get("steward")),
            previous=_normalize_optional_str(config_tags.get("previous")),
            reason=_normalize_optional_str(config_tags.get("reason")),
            effective_at=_normalize_optional_str(config_tags.get("effective_at")),
        )
        conn = _db_connect(args.config)
        draft_id = _db_insert_draft(
            conn,
            kind=30051,
            d=d_value,
            title=None,
            content=content_value,
            tags=tags,
        )
        conn.close()
        export_path = args.out or input("Export JSON path (optional): ").strip() or None
        if export_path:
            payload = _payload_from_draft(30051, d_value, None, content_value, tags, _now())
            _write_json(export_path, payload)
            print(f"Wrote succession record JSON to {export_path}")
        print(f"Saved succession record to database (id {draft_id}).")
        return

    config = _load_config_db(args.config)
    config_tags = config.get("tags", {}) if isinstance(config, dict) else {}
    relays = _merge_optional_list(args.relay, config.get("relays") if isinstance(config, dict) else None) or []
    privkey = _merge_optional(args.privkey, config.get("privkey") if isinstance(config, dict) else None)
    if not privkey:
        raise SystemExit("--privkey is required (or set privkey in config)")

    keys = Keys.parse(privkey)

    if args.command == "document":
        authors_list = _merge_optional_list(args.authors, config_tags.get("authors"))
        try:
            authors_list = _validate_author_keys(authors_list or [])
        except ValueError as exc:
            raise SystemExit(str(exc))
        payload = build_document_json(
            d=args.d,
            title=args.title,
            content=args.content,
            published_at=args.published_at,
            summary=_merge_optional(args.summary, config_tags.get("summary")),
            topics=_merge_optional_list(args.topic, config_tags.get("topics")),
            lang=_merge_optional(args.lang, config_tags.get("lang")),
            version=_merge_optional(args.version, config_tags.get("version")),
            supersedes=_merge_optional_list(args.supersedes, config_tags.get("supersedes")),
            license_id=_merge_optional(args.license, config_tags.get("license")),
            authors=authors_list,
        )
    else:
        payload = build_succession_json(
            d=args.d,
            authoritative_event=args.authoritative_event,
            content=args.content,
            created_at=args.created_at,
            steward=_merge_optional(args.steward, config_tags.get("steward")),
            previous=_merge_optional(args.previous, config_tags.get("previous")),
            reason=_merge_optional(args.reason, config_tags.get("reason")),
            effective_at=_merge_optional(args.effective_at, config_tags.get("effective_at")),
        )

    try:
        with _PUBLISH_LOCK:
            _attempt_publish_payload(payload, relays=relays, keys=keys)
    except Exception as exc:
        _enqueue_publish_task(
            {
                "type": "payload",
                "config_path": args.config,
                "payload": payload,
                "relays": relays,
            }
        )
        print(f"Publish failed: {exc}. Queued for retry.")


if __name__ == "__main__":
    main()
