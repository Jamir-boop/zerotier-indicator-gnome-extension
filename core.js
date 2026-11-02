export function parsePeer(value, defaultPort = 22) {
    const match = /^([^=]+)=((?:\[[0-9a-fA-F:]+\])|(?:[a-zA-Z0-9_](?:[a-zA-Z0-9_.-]*)))(?::([0-9]+))?$/.exec(value.trim());
    if (!match || !match[1].trim() || /[\r\n]/.test(match[1]))
        throw new Error('Use label=host or label=host:port.');
    const port = match[3] === undefined ? defaultPort : Number(match[3]);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error('Use a port from 1 to 65535.');
    return {label: match[1].trim(), host: match[2].replace(/^\[|\]$/g, ''), port};
}

export function zeroTierInterfaces(data) {
    return data.filter(item => item.ifname && item.ifname.startsWith('zt')).map(item => ({
        name: item.ifname,
        up: (item.flags || []).includes('UP'),
        addresses: (item.addr_info || []).filter(address => address.family === 'inet')
            .map(address => `${address.local}/${address.prefixlen}`),
    }));
}

export function isConnected(interfaces) {
    return interfaces.some(item => item.up && item.addresses.length > 0);
}
