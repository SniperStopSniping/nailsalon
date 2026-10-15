/** Local adapter for the same isolated renderer served in Preview. */
import { createServer } from 'node:http';

import handler from './handler.mjs';

const host = process.env.CUSTOM_SITE_RENDER_HOST || '127.0.0.1';
const port = Number(process.env.CUSTOM_SITE_RENDER_PORT || 3198);
createServer(handler).listen(port, host, () => process.stdout.write(`Isolated custom-site renderer listening on ${host}:${port}\n`));
