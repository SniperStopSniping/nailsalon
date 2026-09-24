import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const routes = [
  'api/voice/openai',
  'api/voice/maintenance',
  'api/admin/voice-receptionist/sandbox',
];
let websocketEntry;
for (const route of routes) {
  const entry = resolve(root, '.next/server/app', route, 'route.js');
  const trace = JSON.parse(readFileSync(`${entry}.nft.json`, 'utf8'));
  const files = trace.files.map(file => resolve(dirname(entry), file));
  const external = files.find(file => file.endsWith('/node_modules/ws/index.js'));
  assert.ok(external, `${route}: ws must be traced as a Node package`);
  const serverFiles = [entry, ...files.filter(file => file.includes('/.next/server/') && file.endsWith('.js'))];
  assert.ok(serverFiles.some(file => /(?:require|import)\(["']ws["']\)/u.test(readFileSync(file, 'utf8'))), `${route}: expected an external ws import`);
  assert.ok(!serverFiles.some(file => readFileSync(file, 'utf8').includes('WS_NO_BUFFER_UTIL')), `${route}: ws native-helper loader must not be bundled`);
  websocketEntry = external;
}

const require = createRequire(import.meta.url);
const WebSocket = require(websocketEntry);
const payload = 'synthetic-voice-context-'.repeat(40);
let client;
const server = new WebSocket.WebSocketServer({ host: '127.0.0.1', port: 0 });
try {
  await new Promise((resolveTest, reject) => {
    const timeout = setTimeout(() => reject(new Error('Loopback WebSocket timed out')), 5000);
    const finish = (error) => {
      clearTimeout(timeout);
      if (error) {
        reject(error);
      } else {
        resolveTest();
      }
    };
    server.on('error', finish);
    server.on('connection', (socket) => {
      socket.on('error', finish);
      socket.on('message', (data) => {
        try {
          assert.equal(data.toString(), payload);
          finish();
        } catch (error) {
          finish(error);
        }
      });
    });
    server.on('listening', () => {
      client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
      client.on('error', finish);
      client.on('open', () => {
        try {
          client.send(payload);
        } catch (error) {
          finish(error);
        }
      });
    });
  });
  process.stdout.write('Voice build uses external ws; masked loopback send passed.\n');
} finally {
  client?.terminate();
  for (const socket of server.clients) {
    socket.terminate();
  }
  await new Promise(resolveClose => server.close(resolveClose));
}
