# Codex Usage for GNOME

GNOME Shell extension that shows how much of your Codex plan you have used in the top bar: the 5-hour limit and the weekly limit (`5h 15% · 7d 7%`).

- Each value turns orange from 80% and red from 90%, with a notification when each threshold is crossed (once per period).
- The menu shows when each limit resets.
- Refreshes every 2 minutes. If Codex has not been used for a while, the last known value is shown dimmed.

## How it works

Codex records the rate limits it receives in its local session logs (`~/.codex/sessions/**/rollout-*.jsonl`, `token_count` events). The `codex_usage.py` script (installed as `codex-usage`) reads the most recent one. It needs **no login, token or network access**, and never writes to Codex's files.

> The values are as of the last Codex activity, so they update whenever you use Codex. The log format is not a public API and may change without notice.

If you use a different Codex home, set `CODEX_HOME`.

## Install

```bash
./build-deb.sh            # builds dist/gnome-codex-usage_1.0.0_all.deb
sudo apt install ./dist/gnome-codex-usage_1.0.0_all.deb
gnome-extensions enable codex-usage@local
```

Restart GNOME Shell (X11: Alt+F2, `r`, Enter; Wayland: log out and back in).

For another version: `./build-deb.sh 1.1.0`.

Without root: copy `codex_usage.py` to `~/.local/bin/codex-usage` (executable) and the `codex-usage@local` folder to `~/.local/share/gnome-shell/extensions/`.

## Requirements

- GNOME Shell 45 to 49
- Python 3
- Codex (app or CLI) used at least once
