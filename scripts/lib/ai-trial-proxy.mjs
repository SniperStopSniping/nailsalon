import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';

/** The proxy is deliberately not an arbitrary URL or remote-host forwarder. */
export function aiTrialTunnelPort(authority, profile) {
  assert.equal(profile.https, true);
  const targets = new Map([
    [new URL(profile.origin).host, 3443],
    [new URL(profile.rendererOrigin).host, 3444],
  ]);
  return targets.get(authority) ?? null;
}

export function createAiTrialProxy(profile) {
  const server = http.createServer((_request, response) => {
    response.writeHead(403);
    response.end();
  });
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('connect', (request, socket, head) => {
    const port = aiTrialTunnelPort(request.url, profile);
    if (!port) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const upstream = net.connect(port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) {
        upstream.write(head);
      }
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
  });
  server.closeAllConnections = () => sockets.forEach(socket => socket.destroy());
  return server;
}
