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
        const settings = app.getSettings();
        assert(settings.get_strv('peers').length === 0, 'public peers default is empty');
        assert(settings.get_uint('peer-interval') === 300, 'peer interval default is 300 s');
        assert(['Connected', 'Disconnected'].includes(app._state.status), 'async interface check completes');
        assert(app._rows._getMenuItems().length === 0, 'closed menu builds no rows');
        // Count each check. Demo data keeps owner addresses out of the test and the image.
        const counts = {ip: 0, tcp: 0};
        const reset = () => Object.assign(counts, {ip: 0, tcp: 0});
        let connected = true;
        let delay = 0;
        let lastCancel = null;
        const realPeer = app._peer.bind(app);
        const realInterfaces = app._interfaces.bind(app);
        app._interfaces = async cancel => {
            counts.ip++;
            lastCancel = cancel;
            await realInterfaces(cancel);
            if (delay)
                await sleep(delay);
            return connected ? [{name: 'ztDemo', up: true, addresses: ['192.0.2.1/24']}] : [];
        };
        app._peer = (...args) => {
            counts.tcp++;
            return realPeer(...args);
        };
        // Use a real local listener for both reachable and refused TCP checks.
        const service = new Gio.SocketService();
        const port = service.add_any_inet_port(null);
        service.connect('incoming', (_service, connection) => {
            connection.close(null);
            return true;
        });
        service.start();
        settings.set_strv('peers', [`server=127.0.0.1:${port}`, 'backup=127.0.0.1:1']);
        await sleep(1500);
        assert(counts.tcp === 0, 'peer setting change makes no TCP while the menu is closed');
        const idle = Number(GLib.getenv('ZT_TEST_IDLE_SECONDS') || 20);
        reset();
        await sleep(idle * 1000);
        print(`MEASURE idle ${idle}s, menu closed: ${counts.ip} ip subprocesses, ${counts.tcp} TCP connects`);
        assert(counts.tcp === 0, 'idle menu makes no TCP before the peer interval');
        assert(counts.ip <= Math.ceil(idle / 60), 'idle interface checks follow the 60 s safety interval');
        if (idle < 60)
            assert(counts.ip === 0, 'idle between events: no subprocess');
        const monitor = Gio.NetworkMonitor.get_default();
        reset();
        for (let i = 0; i < 3; i++)
            monitor.emit('network-changed', true);
        await sleep(1600);
        assert(counts.ip === 1 && counts.tcp === 0, 'network-changed burst gives one interface check and no TCP');
        const labels = () => app._rows._getMenuItems().map(row => row.label.text);
        button.menu.open();
        await sleep(2500);
        assert(counts.tcp === 2, 'menu open checks each peer once');
        assert(labels()[0] === 'ZeroTier: Connected' && labels()[1] === 'ztDemo: 192.0.2.1/24' &&
            labels()[3].startsWith('● server: Reachable') && labels()[4].startsWith('○ backup: Unreachable'),
        'menu rows show interface and peer results');
        assert(app._icon.gicon.to_string().includes('zerotier-connected-symbolic'), 'connected icon is distinct');
        assert(button.menu._getMenuItems()[1].visible, 'separator remains visible on first menu open');
        const firstRow = app._rows._getMenuItems()[0];
        const icon = app._icon.gicon;
        app._show(JSON.parse(JSON.stringify(app._state)));
        assert(app._rows._getMenuItems()[0] === firstRow && app._icon.gicon === icon,
            'same results keep menu rows and icon');
        const [x, y] = button.menu.actor.get_transformed_position();
        const [width, height] = button.menu.actor.get_transformed_size();
        const screenshot = new Shell.Screenshot();
        const path = GLib.getenv('ZT_TEST_SCREENSHOT');
        const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.NONE, null);
        await screenshot.screenshot_area(Math.floor(x), 0, Math.ceil(width), Math.ceil(y + height + 8), stream);
        stream.close(null);
        button.menu.close();
        assert(GLib.file_test(path, GLib.FileTest.EXISTS), 'private menu screenshot saved');
        assert(button.menu._getMenuItems()[2].label.text === 'Check now', 'Check now action exists');
        reset();
        button.menu._getMenuItems()[2].activate(null);
        await sleep(2500);
        assert(counts.ip === 1 && counts.tcp === 2, 'Check now checks interfaces and peers');
        settings.set_uint('peer-interval', 0);
        await sleep(300);
        assert(!app._peerTimer, 'zero interval removes the background peer timer');
        settings.set_uint('peer-interval', 60);
        await sleep(300);
        assert(Boolean(app._peerTimer), 'slow background peer timer is optional');
        settings.set_uint('peer-interval', 0);
        await sleep(300);
        reset();
        delay = 200;
        app._check(false);
        app._check(true);
        await sleep(1200);
        assert(counts.ip === 2 && counts.tcp === 2, 'peer request during an interface check is not lost');
        delay = 0;
        connected = false;
        monitor.emit('network-changed', true);
        await sleep(1600);
        assert(app._icon.gicon.to_string().includes('disconnected'), 'disconnected icon is distinct');
        reset();
        button.menu.open();
        await sleep(1500);
        assert(counts.tcp === 0 && labels()[0] === 'ZeroTier: Disconnected' &&
            labels().includes('server: Not checked'), 'no zt connection: peers are not checked');
        button.menu.close();
        service.stop();
        service.close();
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
        // Disable while a check is in flight.
        connected = true;
        delay = 500;
        reset();
        button.menu.open();
        await sleep(100);
        Main.extensionManager.disableExtension(UUID);
        await sleep(400);
        assert(!Main.panel.statusArea[UUID], 'disable removes indicator');
        assert(lastCancel.is_cancelled(), 'disable cancels the in-flight check');
        assert(!app._poll && !app._peerTimer && !app._debounce && !app._cancel && !app._process &&
            !app._networkId, 'disable clears sources, signals and checks');
        monitor.emit('network-changed', true);
        await sleep(1600);
        assert(counts.ip === 1 && counts.tcp === 0, 'no checks or callbacks after disable');
        delay = 0;
        Main.extensionManager.enableExtension(UUID);
        await sleep(1200);
        Main.extensionManager.disableExtension(UUID);
        await sleep(300);
        assert(!Main.panel.statusArea[UUID], 'enable and disable can repeat');
    }
}
