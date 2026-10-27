import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TokenManager } from './auth.js';
import { HelloAssoClient } from './client.js';
import type { Config } from './config.js';
import { registerTools } from './tools.js';
import { VERSION } from './version.js';

export interface ServerDeps {
  config: Config;
  fetch?: typeof fetch;
}

export function createServer({ config, fetch: fetchImpl }: ServerDeps): McpServer {
  const tokens = new TokenManager({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    tokenUrl: config.tokenUrl,
    fetch: fetchImpl,
  });
  const client = new HelloAssoClient({ apiBaseUrl: config.apiBaseUrl, tokens, fetch: fetchImpl });
  const server = new McpServer(
    { name: 'helloasso-mcp', version: VERSION },
    {
      instructions:
        'Read-only access to the HelloAsso API v5 (organizations, forms/campaigns, orders, payments, items). ' +
        'Amounts are in cents. Paginate with pagination.continuationToken.',
    },
  );
  registerTools(server, client, config);
  return server;
}
