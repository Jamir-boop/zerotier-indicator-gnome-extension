import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {isConnected, parsePeer, peerInterval, sameState, zeroTierInterfaces} from './core.js';

// Route signals do not cover every link or address change.
const SAFETY_POLL_SECONDS = 60;

export default class ZeroTierIndicator extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._icons = Object.fromEntries(['connected', 'disconnected'].map(state =>
            [state, Gio.icon_new_for_string(`${this.path}/icons/zerotier-${state}-symbolic.svg`)]));
        this._button = new PanelMenu.Button(0.5, this.metadata.name);
        this._icon = new St.Icon({style_class: 'system-status-icon'});
        this._button.add_child(this._icon);
        this._rows = new PopupMenu.PopupMenuSection();
        this._button.menu.addMenuItem(this._rows);
        this._button.menu.connect('open-state-changed', (_menu, open) => {
            if (!open)
                return;
            this._renderRows();
            this._check(true);
        });
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._button.menu.addAction('Check now', () => this._check(true));
        this._button.menu.addAction('Settings', () => this.openPreferences());
        Main.panel.addToStatusArea(this.uuid, this._button);
        this._queued = null;
        this._renderedState = null;
        this._show({status: 'Checking…', interfaces: [], peers: null});
        this._network = Gio.NetworkMonitor.get_default();
        this._networkId = this._network.connect('network-changed', () => this._queueInterfaceCheck());
        this._changedId = this._settings.connect('changed', (_settings, key) => {
            if (key !== 'peer-interval') {
                this._state = {...this._state, peers: null};
                this._renderedState = null;
                if (this._button.menu.isOpen)
                    this._renderRows();
            }
            this._restart();
        });
        this._restart();
    }

    disable() {
        this._stop();
        this._network.disconnect(this._networkId);
        this._network = null;
        this._networkId = 0;
        this._settings.disconnect(this._changedId);
        this._settings = null;
        this._button.destroy();
        this._button = null;
        this._rows = null;
        this._icon = null;
        this._icons = null;
        this._state = null;
        this._renderedState = null;
        this._iconState = null;
    }

    _stop() {
        for (const name of ['_poll', '_peerTimer', '_debounce']) {
            if (this[name])
                GLib.Source.remove(this[name]);
            this[name] = 0;
        }
        this._queued = null;
        if (this._cancel)
            this._cancel.cancel();
        this._cancel = null;
        if (this._process)
            this._process.force_exit();
        this._process = null;
    }

    _restart() {
        this._stop();
        this._poll = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SAFETY_POLL_SECONDS, () => {
            this._check(false);
            return GLib.SOURCE_CONTINUE;
        });
        const interval = peerInterval(this._settings.get_uint('peer-interval'));
        if (interval && this._settings.get_strv('peers').length > 0) {
            this._peerTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
                this._check(true);
                return GLib.SOURCE_CONTINUE;
            });
        }
        this._check(this._button.menu.isOpen);
    }

    _queueInterfaceCheck() {
        if (this._debounce)
            return;
        this._debounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._debounce = 0;
            this._check(false);
            return GLib.SOURCE_REMOVE;
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

    async _check(withPeers) {
        if (this._cancel) {
            // Run once more after the current check, so no request is lost.
            this._queued = Boolean(this._queued) || withPeers;
            return;
        }
        const cancel = new Gio.Cancellable();
        this._cancel = cancel;
        try {
            const interfaces = await this._interfaces(cancel);
            if (cancel.is_cancelled())
                return;
            const connected = isConnected(interfaces);
            let peers = connected ? this._state.peers : null;
            if (connected && withPeers) {
                const port = this._settings.get_uint('check-port');
                peers = await Promise.all(this._settings.get_strv('peers').map(value => {
                    try {
                        return this._peer(parsePeer(value, port), cancel);
                    } catch (_error) {
                        return {label: 'Invalid peer setting', invalid: true};
                    }
                }));
            }
            if (!cancel.is_cancelled())
                this._show({status: connected ? 'Connected' : 'Disconnected', interfaces, peers});
        } catch (_error) {
            if (!cancel.is_cancelled())
                this._show({status: 'Interface check failed', interfaces: [], peers: null});
        } finally {
            if (this._cancel === cancel) {
                this._cancel = null;
                if (this._queued !== null) {
                    const next = this._queued;
                    this._queued = null;
                    this._check(next);
                }
            }
        }
    }

    _show(state) {
        if (sameState(state, this._state))
            return;
        this._state = state;
        const iconState = state.status === 'Connected' ? 'connected' : 'disconnected';
        if (this._iconState !== iconState) {
            this._iconState = iconState;
            this._icon.gicon = this._icons[iconState];
        }
        this._button.accessible_name = `ZeroTier: ${state.status}`;
        if (this._button.menu.isOpen)
            this._renderRows();
    }

    _renderRows() {
        const state = this._state;
        if (sameState(state, this._renderedState))
            return;
        this._renderedState = state;
        this._rows.removeAll();
        const row = text => this._rows.addMenuItem(new PopupMenu.PopupMenuItem(text, {reactive: false}));
        row(`ZeroTier: ${state.status}`);
        for (const item of state.interfaces)
            row(`${item.name}: ${item.addresses.join(', ') || 'No IPv4'}${item.up ? '' : ' (down)'}`);
        row('Peers');
        const values = this._settings.get_strv('peers');
        if (values.length === 0)
            row('No peers configured');
        if (state.peers === null) {
            for (const value of values) {
                try {
                    row(`${parsePeer(value).label}: Not checked`);
                } catch (_error) {
                    row('Invalid peer setting');
                }
            }
            return;
        }
        for (const peer of state.peers) {
            row(peer.invalid ? peer.label :
                `${peer.reachable ? '●' : '○'} ${peer.label}: ${peer.reachable ? 'Reachable' : 'Unreachable'} · ${peer.time}`);
        }
    }
}
