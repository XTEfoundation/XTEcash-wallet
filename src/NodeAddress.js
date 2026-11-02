// Copyright (C) 2018, Zpalmtree
//
// Please see the included LICENSE file for more information.

/**
 * Persisted daemon address.
 *
 * Format: "host:port:ssl" or "host:port:plain".
 * Older builds stored "host:port" from Daemon.getConnectionString(), which
 * drops the TLS flag. Port 443 is the documented XTE TLS daemon port, so
 * those legacy strings are treated as SSL. Every other legacy port is plain
 * TCP, matching the public node list.
 */

const SSL = 'ssl';
const PLAIN = 'plain';

export function formatNode(host, port, ssl) {
    return `${host}:${port}:${ssl ? SSL : PLAIN}`;
}

export function parseNode(node) {
    const parts = String(node || '').split(':');
    const host = parts[0] || '';
    const port = Number(parts[1]);

    if (parts[2] === SSL) {
        return { host, port, ssl: true };
    }

    if (parts[2] === PLAIN) {
        return { host, port, ssl: false };
    }

    return {
        host,
        port,
        ssl: port === 443,
    };
}

export function formatListedNode(node) {
    return formatNode(node.url, node.port, node.ssl === true);
}

export function sameNode(stored, listed) {
    const left = parseNode(stored);
    const right = parseNode(formatListedNode(listed));

    return left.host === right.host
        && left.port === right.port
        && left.ssl === right.ssl;
}
