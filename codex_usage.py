#!/usr/bin/env python3
"""Codex plan usage (5-hour and weekly limits) as JSON, for the GNOME top bar.

Codex records the rate limits it receives in its local session logs
(~/.codex/sessions/**/rollout-*.jsonl, "token_count" events). This script reads
the most recent one: no login, token or network access is needed. The values
are as of the last Codex activity, so they refresh whenever Codex is used.
"""
import glob
import json
import os
import sys
import time
from datetime import datetime, timezone

CODEX_HOME = os.environ.get("CODEX_HOME") or os.path.expanduser("~/.codex")
SESSIONS = os.path.join(CODEX_HOME, "sessions")
TAIL_BYTES = 512 * 1024
MAX_FILES = 8
STALE_AFTER = 3600


def last_rate_limits(path):
    """Newest (timestamp, rate_limits) in a session log, or None."""
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - TAIL_BYTES))
            lines = f.read().splitlines()
    except OSError:
        return None
    for line in reversed(lines):
        if b'"rate_limits"' not in line:
            continue
        try:
            event = json.loads(line)
        except ValueError:
            continue  # first line of the tail may be cut in half
        limits = (event.get("payload") or {}).get("rate_limits")
        if limits and (limits.get("primary") or limits.get("secondary")):
            return event.get("timestamp") or "", limits
    return None


def newest_rate_limits():
    files = glob.glob(os.path.join(SESSIONS, "*", "*", "*", "rollout-*.jsonl"))
    files.sort(key=lambda p: os.stat(p).st_mtime, reverse=True)
    found = [r for r in map(last_rate_limits, files[:MAX_FILES]) if r]
    return max(found, key=lambda r: r[0]) if found else None


def window(block, now):
    """(percent, resets_at ISO) of one limit; a window that already reset is 0%."""
    if not block or block.get("used_percent") is None:
        return None, None
    resets = block.get("resets_at")
    if resets is not None and resets <= now:
        return 0, None
    iso = None if resets is None else datetime.fromtimestamp(resets, timezone.utc).isoformat()
    return round(block["used_percent"]), iso


def fetch():
    if not os.path.isdir(SESSIONS):
        return {"error": "Codex sessions not found (is Codex installed?)"}
    found = newest_rate_limits()
    if not found:
        return {"error": "No usage data yet: use Codex once"}
    stamp, limits = found
    now = time.time()
    out = {}
    for key, src in (("session", "primary"), ("weekly", "secondary")):
        out[key], out[key + "_resets_at"] = window(limits.get(src), now)
    try:
        fetched = datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()
    except ValueError:
        fetched = now
    out["fetched_at"] = int(fetched)
    out["plan"] = limits.get("plan_type")
    if now - fetched > STALE_AFTER:
        out["stale"] = True
    return out


if __name__ == "__main__":
    json.dump(fetch(), sys.stdout)
    print()
