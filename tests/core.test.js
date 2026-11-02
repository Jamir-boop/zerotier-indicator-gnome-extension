import {isConnected, parsePeer, zeroTierInterfaces} from '../core.js';

let count = 0;
function assert(value) {
    if (!value)
        throw new Error(`Assertion ${count + 1} failed`);
    count++;
}
assert(JSON.stringify(parsePeer(' server=example.invalid ')) ===
    JSON.stringify({label: 'server', host: 'example.invalid', port: 22}));
assert(parsePeer('server=example.invalid:443').port === 443);
assert(parsePeer('server=example.invalid', 80).port === 80);
assert(parsePeer('server=[::1]:22').host === '::1');
for (const value of ['', 'host', '=host', ' =host', 'a=host:0', 'a=host:65536',
    'a=host:abc', 'a=host/path', 'a=host extra', 'a=host:22:23', 'a=https://host']) {
    let invalid = false;
    try {
        parsePeer(value);
    } catch (_error) {
        invalid = true;
    }
    assert(invalid);
}
const address = {family: 'inet', local: '192.0.2.1', prefixlen: 24};
const data = zeroTierInterfaces([
    {ifname: 'eth0', flags: ['UP'], addr_info: [address]},
    {ifname: 'ztDemo', flags: ['UP'], addr_info: [address]},
    {ifname: 'ztDown', flags: [], addr_info: [address]},
    {ifname: 'ztEmpty', flags: ['UP'], addr_info: [{family: 'inet6'}]},
]);
assert(data.length === 3);
assert(isConnected(data));
assert(!isConnected(data.slice(1)));
assert(!isConnected([]));
assert(!isConnected(zeroTierInterfaces([{ifname: 'ztEmpty'}])));
assert(data[0].addresses[0] === '192.0.2.1/24');
print(`PASS ${count} core assertions`);
