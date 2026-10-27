# helloasso-mcp

Read-only [Model Context Protocol](https://modelcontextprotocol.io) server (stdio) for the
[HelloAsso API v5](https://dev.helloasso.com). It lets an MCP client (Claude Desktop, Cursor,
any agent supporting stdio MCP servers...) read an association's HelloAsso data: organization,
forms/campaigns (memberships, events, donations, shops...), orders, payments and items
(members, participants, with custom fields).

**Read-only by design**: the server only issues `GET` requests. It never creates checkouts,
refunds, cancels orders or edits forms.

## Tools

| Tool | Description |
| --- | --- |
| `helloasso_get_organization` | Public details of an organization. |
| `helloasso_list_my_organizations` | Organizations the API client has rights on (find your slug). |
| `helloasso_list_form_types` | Form types for which the organization has at least one form. |
| `helloasso_list_forms` | List forms/campaigns, filter by type (`Membership`, `Event`, `Donation`, `Shop`, `CrowdFunding`, `PaymentForm`, `Checkout`) and state. |
| `helloasso_get_form` | Public details of one form (tiers/prices, custom fields, dates...). |
| `helloasso_get_form_stats` | Statistics of one form. |
| `helloasso_list_orders` | Orders of the organization or of one form, with date range / search. |
| `helloasso_list_payments` | Payments of the organization or of one form, with date range, states, sorting. |
| `helloasso_list_items` | Items of the organization or of one form, e.g. members of a membership campaign, with custom fields (`withDetails` defaults to `true`). |
| `helloasso_get_order` | One order by id. |
| `helloasso_get_payment` | One payment by id. |
| `helloasso_get_item` | One item by id, with custom fields. |

Notes:

- Every organization-scoped tool accepts an optional `orgSlug`; it defaults to `HELLOASSO_ORG_SLUG`.
- List tools give `formType` + `formSlug` to restrict to a single form.
- Pagination: results contain `pagination` (`pageIndex`, `pageSize`, `totalCount`, `totalPages`,
  `continuationToken`). Pass `continuationToken` back to get the next page. `pageSize` is limited to 100 here.
- Dates (`from` inclusive, `to` exclusive) are ISO 8601: `2026-01-01` or `2026-01-01T00:00:00Z`.
- Amounts returned by HelloAsso are in **cents**.
- Output is compact JSON (null / empty values removed).

## 1. Get API credentials

You need an API client (a *Client ID* and a *Client Secret*) from the association's HelloAsso back-office.
You must be an administrator of the association.

1. Sign in to your association's HelloAsso back-office.
2. Open **Mon compte** → **Intégrations et API**.
3. Click **Générer ma clé API** if no key exists yet.
4. Copy the **Client ID** and the **Client Secret**.

Your organization slug is the last part of your public page URL:
`https://www.helloasso.com/associations/<slug>` (for example `my-association`).

For testing, create a free test organization on <https://www.helloasso-sandbox.com> and generate
a key there: sandbox keys only work with `HELLOASSO_ENV=sandbox`.

> ⚠️ Treat the Client Secret like a password. An association API client also has the `Checkout`
> privilege and can refund payments through the API. This server does not use those capabilities,
> but the key itself allows them: never commit it, paste it in a chat or share it.

## 2. Install and build

Requires Node.js 20+.

```bash
git clone https://github.com/NicolasMassart/helloasso-mcp.git
cd helloasso-mcp
npm install        # also builds (prepare script)
npm run build      # if needed
npm test
```

## 3. Configuration (environment variables)

| Variable | Required | Description |
| --- | --- | --- |
| `HELLOASSO_CLIENT_ID` | yes | API Client ID. |
| `HELLOASSO_CLIENT_SECRET` | yes | API Client Secret. |
| `HELLOASSO_ORG_SLUG` | recommended | Default organization slug, e.g. `my-association`. |
| `HELLOASSO_ENV` | no | `sandbox` (default) or `production`. |

| `HELLOASSO_ENV` | Token URL | API base URL |
| --- | --- | --- |
| `sandbox` | `https://api.helloasso-sandbox.com/oauth2/token` | `https://api.helloasso-sandbox.com/v5` |
| `production` | `https://api.helloasso.com/oauth2/token` | `https://api.helloasso.com/v5` |

The server starts even without credentials (tools then return a clear error), so you can check
that your MCP client sees it before configuring the keys.

## 4. Add it to an MCP client

Stdio command: `node /absolute/path/to/helloasso-mcp/dist/index.js`

Generic configuration (Claude Desktop `claude_desktop_config.json`, Cursor `.cursor/mcp.json`, ...):

```json
{
  "mcpServers": {
    "helloasso": {
      "command": "node",
      "args": ["/absolute/path/to/helloasso-mcp/dist/index.js"],
      "env": {
        "HELLOASSO_CLIENT_ID": "<your client id>",
        "HELLOASSO_CLIENT_SECRET": "<your client secret>",
        "HELLOASSO_ORG_SLUG": "my-association",
        "HELLOASSO_ENV": "production"
      }
    }
  }
}
```

You can also run it with `npx /absolute/path/to/helloasso-mcp` (after `npm install` in that folder).

Quick check without any client (lists the tools, makes no HelloAsso call):

```bash
npm run smoke
```

or with the MCP Inspector: `npx @modelcontextprotocol/inspector node dist/index.js`.

## Authentication and limits

- OAuth2 `client_credentials` on the token URL; the access token (30 min) is cached in memory and
  renewed with the `refresh_token` (valid 30 days), as HelloAsso requires. Client credentials are
  only used again if the refresh token is missing, expired or rejected.
- The token endpoint is rate limited by HelloAsso (10 calls / 10 s, 20 / 10 min, 50 / hour).
  The cache lives in the server process, so each new process authenticates once.
- On `401` the token is renewed once and the request retried. `403` usually means the API client
  lacks the role/privilege for that route (transactions need `OrganizationAdmin` or `FormAdmin`
  and `AccessTransactions`) or that the slug is not the client's own organization.
  `429` errors report the `Retry-After` delay when HelloAsso sends one.
- Secrets are never logged; logs go to stderr only (stdout is the MCP channel).

## Development

```bash
npm test          # vitest, fetch is mocked: no network, no credentials needed
npm run typecheck
npm run build
npm run smoke     # starts dist/index.js over stdio and calls tools/list
```

Endpoints and enums follow the official OpenAPI specification:
<https://github.com/HelloAsso/helloasso-open-api>.

## License

MIT
