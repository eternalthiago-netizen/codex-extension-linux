import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

// The .deb package installs to /usr/bin; a manual install lives in ~/.local/bin
const SCRIPT = GLib.find_program_in_path('codex-usage') ??
    GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'codex-usage']);
const POLL_SECONDS = 120;
const THRESHOLDS = [80, 90];
// Alerts already sent, per limit and period (resets_at): survives Shell restarts
const ALERTS_FILE = GLib.build_filenamev([GLib.get_user_cache_dir(), 'codex-usage-alerts.json']);
const LIMITS = {session: '5-hour session', weekly: 'Weekly limit'};

function loadAlerts() {
    try {
        const [, bytes] = GLib.file_get_contents(ALERTS_FILE);
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        return {};
    }
}

function saveAlerts(alerts) {
    try {
        GLib.file_set_contents(ALERTS_FILE, JSON.stringify(alerts));
    } catch (e) {
        logError(e);
    }
}

function run() {
    return new Promise((resolve, reject) => {
        const proc = Gio.Subprocess.new([SCRIPT],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        proc.communicate_utf8_async(null, null, (p, res) => {
            try {
                resolve(p.communicate_utf8_finish(res)[1]);
            } catch (e) {
                reject(e);
            }
        });
    });
}

function color(pct) {
    if (pct >= 90)
        return 'color: #ff6b6b;';
    if (pct >= 80)
        return 'color: #ffb347;';
    return '';
}

function resetText(iso) {
    if (!iso)
        return '';
    const dt = GLib.DateTime.new_from_iso8601(iso, null)?.to_local();
    if (!dt)
        return '';
    const mins = Math.max(0, Math.round(dt.difference(GLib.DateTime.new_now_local()) / 60e6));
    const left = mins < 60 ? `${mins} min` : mins < 48 * 60
        ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${Math.round(mins / 1440)} days`;
    return `resets ${dt.format('%b %d %H:%M')} (in ${left})`;
}

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Codex Usage');

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._session = new St.Label({text: '5h …', y_align: Clutter.ActorAlign.CENTER});
        this._sep = new St.Label({text: ' · ', y_align: Clutter.ActorAlign.CENTER});
        this._weekly = new St.Label({text: '7d …', y_align: Clutter.ActorAlign.CENTER});
        for (const l of [this._session, this._sep, this._weekly]) {
            l.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            box.add_child(l);
        }
        this.add_child(box);

        this._sessionItem = new PopupMenu.PopupMenuItem('Session (5 h)', {reactive: false});
        this._weeklyItem = new PopupMenu.PopupMenuItem('Weekly', {reactive: false});
        this.menu.addMenuItem(this._sessionItem);
        this.menu.addMenuItem(this._weeklyItem);
        this._staleItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._staleItem.visible = false;
        this.menu.addMenuItem(this._staleItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const refresh = new PopupMenu.PopupMenuItem('Refresh');
        refresh.connect('activate', () => this.refresh());
        this.menu.addMenuItem(refresh);

        this.menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this.refresh();
        });

        this.refresh();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    async refresh() {
        let st;
        try {
            st = JSON.parse(await run());
        } catch (e) {
            st = {error: String(e)};
        }
        if (st.error && st.session === undefined) {
            this._session.text = 'Codex —';
            this._sep.visible = this._weekly.visible = false;
            this._session.style = '';
            this.opacity = 255;
            this._staleItem.visible = false;
            this._sessionItem.label.text = st.error;
            this._weeklyItem.label.text = '';
            return;
        }
        this._sep.visible = this._weekly.visible = true;
        // Old value (expired login / no network): shown dimmed, with the reason
        this.opacity = st.stale ? 140 : 255;
        this._session.text = `5h ${st.session ?? '—'}%`;
        this._weekly.text = `7d ${st.weekly ?? '—'}%`;
        this._session.style = color(st.session ?? 0);
        this._weekly.style = color(st.weekly ?? 0);
        this._sessionItem.label.text = `Session (5 h): ${st.session ?? '—'}% · ${resetText(st.session_resets_at)}`;
        this._weeklyItem.label.text = `Weekly: ${st.weekly ?? '—'}% · ${resetText(st.weekly_resets_at)}`;
        if (!st.stale)
            this._checkAlerts(st);
        this._staleItem.visible = Boolean(st.stale);
        if (st.stale) {
            const when = GLib.DateTime.new_from_unix_local(st.fetched_at ?? 0).format('%b %d %H:%M');
            this._staleItem.label.text = `Last Codex activity: ${when}. ${st.error ?? "Use Codex to refresh."}`;
        }
    }

    _checkAlerts(st) {
        const alerts = loadAlerts();
        let changed = false;
        for (const [key, name] of Object.entries(LIMITS)) {
            const pct = st[key];
            const period = st[`${key}_resets_at`];
            if (pct === null || pct === undefined || !period)
                continue;
            // New period (the limit reset): forget earlier alerts
            if (alerts[key]?.period !== period) {
                alerts[key] = {period, sent: []};
                changed = true;
            }
            // Only the highest threshold crossed and not yet alerted
            const hit = THRESHOLDS.filter(t => pct >= t && !alerts[key].sent.includes(t));
            if (hit.length === 0)
                continue;
            const top = Math.max(...hit);
            alerts[key].sent.push(...hit);
            changed = true;
            this._notify(`${name}: ${pct}% used`,
                `${resetText(period).replace(/^r/, 'R')}.`, top >= 90);
        }
        if (changed)
            saveAlerts(alerts);
    }

    _notify(title, body, urgent) {
        const source = MessageTray.getSystemSource();
        const notification = new MessageTray.Notification({
            source, title, body,
            iconName: urgent ? 'dialog-warning-symbolic' : 'dialog-information-symbolic',
            urgency: urgent ? MessageTray.Urgency.CRITICAL : MessageTray.Urgency.NORMAL,
        });
        source.addNotification(notification);
    }

    destroy() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = null;
        }
        super.destroy();
    }
});

export default class CodexUsageExtension extends Extension {
    enable() {
        this._indicator = new Indicator();
        // position 0 of the right box = next to the headset indicator
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
