import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {isConnected, parsePeer, zeroTierInterfaces} from './core.js';

export default class ZeroTierIndicator extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._button = new PanelMenu.Button(0.5, this.metadata.name);
        this._icon = new St.Icon({style_class: 'system-status-icon'});
        this._button.add_child(this._icon);
        this._rows = new PopupMenu.PopupMenuSection();
        this._button.menu.addMenuItem(this._rows);
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._button.menu.addAction('Check now', () => this._check());
        this._button.menu.addAction('Settings', () => this.openPreferences());
        Main.panel.addToStatusArea(this.uuid, this._button);
        this._render('Checking…', [], []);
        this._changedId = this._settings.connect('changed', () => this._restart());
        this._restart();
    }

    disable() {
        this._stop();
        this._settings.disconnect(this._changedId);
        this._settings = null;
        this._button.destroy();
        this._button = null;
        this._rows = null;
        this._icon = null;
    }

    _stop() {
        if (this._timer) {
            GLib.Source.remove(this._timer);
            this._timer = 0;
        }
        if (this._cancel)
            this._cancel.cancel();
        this._cancel = null;
        if (this._process)
            this._process.force_exit();
        this._process = null;
    }

    _restart() {
        this._stop();
        this._check();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            this._settings.get_uint('poll-interval'), () => {
                this._check();
                return GLib.SOURCE_CONTINUE;
            });
    }

    _interfaces(cancel) {
        return new Promise((resolve, reject) => {
            const process = Gio.Subprocess.new(['ip', '-j', 'address', 'show'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            this._process = process;
            process.communicate_utf8_async(null, cancel, (source, result) => {
                if (this._process === process)
                    this._process = null;
                try {
                    const [, output] = source.communicate_utf8_finish(result);
                    if (!source.get_successful())
                        throw new Error('Interface check failed.');
                    resolve(zeroTierInterfaces(JSON.parse(output)));
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    _peer(peer, cancel) {
        return new Promise(resolve => {
            const client = new Gio.SocketClient({timeout: 2});
            client.connect_async(Gio.NetworkAddress.new(peer.host, peer.port), cancel, (source, result) => {
                let reachable = false;
                try {
                    const connection = source.connect_finish(result);
                    connection.close(null);
                    reachable = true;
                } catch (_error) {
                    // A closed port or timeout is an expected check result.
                }
                resolve({...peer, reachable, time: new Date().toLocaleTimeString()});
            });
        });
    }

    async _check() {
        if (this._cancel)
            return;
        const cancel = new Gio.Cancellable();
        this._cancel = cancel;
        try {
            const interfaces = await this._interfaces(cancel);
            if (cancel.is_cancelled())
                return;
            const port = this._settings.get_uint('check-port');
            const peers = this._settings.get_strv('peers').map(value => {
                try {
                    return this._peer(parsePeer(value, port), cancel);
                } catch (_error) {
                    return {label: 'Invalid peer setting', invalid: true};
                }
            });
            const results = await Promise.all(peers);
            if (!cancel.is_cancelled())
                this._render(isConnected(interfaces) ? 'Connected' : 'Disconnected', interfaces, results);
        } catch (_error) {
            if (!cancel.is_cancelled())
                this._render('Interface check failed', [], []);
        } finally {
            if (this._cancel === cancel)
                this._cancel = null;
        }
    }

    _render(status, interfaces, peers) {
        this._rows.removeAll();
        const state = status === 'Connected' ? 'connected' : 'disconnected';
        this._icon.gicon = Gio.icon_new_for_string(`${this.path}/icons/zerotier-${state}-symbolic.svg`);
        this._button.accessible_name = `ZeroTier: ${status}`;
        const row = text => this._rows.addMenuItem(new PopupMenu.PopupMenuItem(text, {reactive: false}));
        row(`ZeroTier: ${status}`);
        for (const item of interfaces)
            row(`${item.name}: ${item.addresses.join(', ') || 'No IPv4'}${item.up ? '' : ' (down)'}`);
        row('Peers');
        if (peers.length === 0)
            row('No peers configured');
        for (const peer of peers) {
            row(peer.invalid ? peer.label :
                `${peer.reachable ? '●' : '○'} ${peer.label}: ${peer.reachable ? 'Reachable' : 'Unreachable'} · ${peer.time}`);
        }
    }
}
