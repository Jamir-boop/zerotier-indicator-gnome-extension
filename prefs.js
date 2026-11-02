import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {parsePeer} from './core.js';

export default class ZeroTierPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({title: 'ZeroTier Indicator', icon_name: 'network-wired-symbolic'});
        const group = new Adw.PreferencesGroup({title: 'Checks'});
        page.add(group);
        window.add(page);
        for (const [key, title, upper] of [
            ['poll-interval', 'Poll interval (seconds)', 3600],
            ['check-port', 'Default TCP port', 65535],
        ]) {
            const row = new Adw.SpinRow({
                title,
                adjustment: new Gtk.Adjustment({lower: 1, upper, step_increment: 1, page_increment: 10}),
            });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
        }
        const peers = new Adw.PreferencesGroup({
            title: 'Peers',
            description: 'One label=host or label=host:port per line. Apply to save. Empty text removes all peers.',
        });
        page.add(peers);
        const text = new Gtk.TextView({
            buffer: new Gtk.TextBuffer({text: settings.get_strv('peers').join('\n')}),
            monospace: true,
            top_margin: 12, bottom_margin: 12, left_margin: 12, right_margin: 12,
            height_request: 140,
        });
        peers.add(text);
        const errorLabel = new Gtk.Label({wrap: true, xalign: 0});
        peers.add(errorLabel);
        const apply = new Gtk.Button({label: 'Apply peers', halign: Gtk.Align.START});
        apply.connect('clicked', () => {
            const values = text.buffer.text.split('\n').map(value => value.trim()).filter(Boolean);
            try {
                for (const value of values)
                    parsePeer(value, settings.get_uint('check-port'));
                settings.set_strv('peers', values);
                errorLabel.label = 'Saved';
            } catch (error) {
                errorLabel.label = error.message;
            }
        });
        peers.add(apply);
    }
}
