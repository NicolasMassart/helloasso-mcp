// Starts the built server over stdio and prints its tools (no HelloAsso call is made).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  env: { PATH: process.env.PATH ?? '', HELLOASSO_ENV: 'sandbox', HELLOASSO_ORG_SLUG: 'my-association' },
  stderr: 'inherit',
});
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);
const { tools } = await client.listTools();
for (const t of tools) console.log(`${t.name}: ${t.description}`);
const r = await client.callTool({ name: 'helloasso_get_organization', arguments: {} });
console.log('call without credentials ->', r.isError ? 'isError' : 'ok', r.content[0].text);
await client.close();
if (tools.length !== 12) process.exit(1);
