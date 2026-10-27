#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { VERSION } from './version.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createServer({ config });
  await server.connect(new StdioServerTransport());
  // stdout is reserved for the MCP protocol: log to stderr only, and never log secrets.
  const creds = config.clientId && config.clientSecret ? 'credentials set' : 'credentials MISSING';
  console.error(
    `helloasso-mcp ${VERSION} running on stdio (env=${config.env}, default org=${config.defaultOrgSlug ?? 'none'}, ${creds})`,
  );
}

main().catch((err) => {
  console.error(`helloasso-mcp failed to start: ${(err as Error).message}`);
  process.exit(1);
});
