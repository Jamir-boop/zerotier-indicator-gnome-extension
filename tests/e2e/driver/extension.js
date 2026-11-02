import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const UUID = 'zerotier-indicator@jamir-boop.github.io';
const sleep = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));
function assert(value, message) {
    if (!value)
        throw new Error(message);
    print(`PASS ${message}`);
}
export default class TestDriver extends Extension {
    enable() {
        this._run().then(() => {
            GLib.file_set_contents(GLib.getenv('ZT_TEST_RESULT'), 'PASS\n');
        }).catch(error => {
            logError(error);
            GLib.file_set_contents(GLib.getenv('ZT_TEST_RESULT'), `FAIL ${error.stack}\n`);
        }).finally(() => global.context.terminate());
    }
    disable() {}
    async _run() {
        if (Main.layoutManager._startingUp)
            await new Promise(resolve => Main.layoutManager.connect('startup-complete', resolve));
        Main.overview.hide();
        await sleep(1000);
        Main.extensionManager.enableExtension(UUID);
        await sleep(3000);
        const extension = Main.extensionManager.lookup(UUID);
        assert(extension.state === 1, `extension active (${extension.error || 'no error'})`);
        const app = extension.stateObj;
        const button = Main.panel.statusArea[UUID];
        assert(Boolean(button), 'panel indicator exists');
        assert(app.getSettings().get_strv('peers').length === 0, 'public peers default is empty');
        // Use a real local listener for both reachable and refused TCP checks.
        const service = new Gio.SocketService();
        const port = service.add_any_inet_port(null);
        service.connect('incoming', (_service, connection) => {
            connection.close(null);
            return true;
        });
        service.start();
        const results = await Promise.all([
            app._peer({label: 'local', host: '127.0.0.1', port}, new Gio.Cancellable()),
            app._peer({label: 'closed', host: '127.0.0.1', port: 1}, new Gio.Cancellable()),
        ]);
        assert(results[0].reachable, 'open TCP port is reachable');
        assert(!results[1].reachable, 'closed TCP port is unreachable');
        service.stop();
        service.close();
        const labels = () => app._rows._getMenuItems().map(row => row.label.text);
        assert(labels().some(text => text.startsWith('zt')), 'async interface check shows ZeroTier');
        assert(button.menu._getMenuItems()[2].label.text === 'Check now', 'Check now action exists');
        button.menu._getMenuItems()[2].activate(null);
        await sleep(1000);
        // Only the private shell gets demo data. No owner addresses enter the image.
        app._render('Connected', [{name: 'ztDemo', up: true, addresses: ['192.0.2.1/24']}], [
            {label: 'server', reachable: true, time: '12:00:00'},
            {label: 'backup', reachable: false, time: '12:00:00'},
        ]);
        button.menu.open();
        await sleep(600);
        const [x, y] = button.menu.actor.get_transformed_position();
        const [width, height] = button.menu.actor.get_transformed_size();
        const screenshot = new Shell.Screenshot();
        const path = GLib.getenv('ZT_TEST_SCREENSHOT');
        const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.NONE, null);
        await screenshot.screenshot_area(Math.floor(x), 0, Math.ceil(width), Math.ceil(y + height + 8), stream);
        stream.close(null);
        button.menu.close();
        assert(GLib.file_test(path, GLib.FileTest.EXISTS), 'private menu screenshot saved');
        button.menu._getMenuItems()[3].activate(null);
        let prefs = null;
        for (let i = 0; i < 100 && !prefs; i++) {
            // eslint-disable-next-line no-await-in-loop
            await sleep(200);
            prefs = global.get_window_actors().map(actor => actor.meta_window)
                .find(window => window.get_title() === 'ZeroTier Indicator');
        }
        assert(Boolean(prefs), 'Settings opens preferences');
        prefs.delete(global.get_current_time());
        await sleep(500);
        Main.extensionManager.disableExtension(UUID);
        await sleep(400);
        assert(!Main.panel.statusArea[UUID], 'disable removes indicator');
        assert(!app._timer && !app._cancel && !app._process, 'disable clears timer and checks');
        Main.extensionManager.enableExtension(UUID);
        await sleep(1200);
        Main.extensionManager.disableExtension(UUID);
        await sleep(300);
        assert(!Main.panel.statusArea[UUID], 'enable and disable can repeat');
    }
}
