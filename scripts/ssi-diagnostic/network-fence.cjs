'use strict';

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');

const host = process.env.LUSTER_SCALE_ALLOWED_HOST;
const port = Number(process.env.LUSTER_SCALE_ALLOWED_PORT);
if (host !== '127.0.0.1' || port !== 55432) {
  throw new Error('Scale network fence requires the exact owned loopback PostgreSQL endpoint.');
}

const denied = (operation) => {
  throw new Error('Scale network fence denied ' + operation);
};
const socketTargetAllowed = (argumentsList) => {
  const first = argumentsList[0];
  if (typeof first === 'number') {
    return first === port && argumentsList[1] === host;
  }
  if (typeof first === 'object' && first !== null) {
    return first.port === port && (first.host === host || first.hostname === host);
  }
  return false;
};
const originalSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function fencedSocketConnect(...argumentsList) {
  if (!socketTargetAllowed(argumentsList)) {
    denied('socket connect');
  }
  return originalSocketConnect.apply(this, argumentsList);
};
net.connect = (...argumentsList) => {
  const socket = new net.Socket();
  return socket.connect(...argumentsList);
};
net.createConnection = net.connect;
for (const module of [http, https]) {
  module.request = () => denied('HTTP request');
  module.get = () => denied('HTTP get');
}
tls.connect = () => denied('TLS connect');
globalThis.fetch = async () => denied('fetch');
