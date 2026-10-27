import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { HelloAssoClient, QueryValue } from './client.js';
import type { Config } from './config.js';
import { toCompactJson } from './format.js';

// Enum values from the HelloAsso v5 OpenAPI specification.
export const FORM_TYPES = ['CrowdFunding', 'Membership', 'Event', 'Donation', 'PaymentForm', 'Checkout', 'Shop'] as const;
export const FORM_STATES = ['Public', 'Private', 'Draft', 'Disabled'] as const;
export const PAYMENT_STATES = [
  'Pending', 'Authorized', 'Refused', 'Unknown', 'Registered', 'Error', 'Refunded', 'Refunding', 'Waiting',
  'Canceled', 'Contested', 'WaitingBankValidation', 'WaitingBankWithdraw', 'Abandoned', 'WaitingAuthentication',
  'AuthorizedPreprod', 'Corrected', 'Deleted', 'Inconsistent', 'NoDonation', 'Init',
] as const;
export const ITEM_STATES = ['Waiting', 'Processed', 'Registered', 'Deleted', 'Unknown', 'Canceled', 'Refused', 'Abandoned'] as const;
export const TIER_TYPES = [
  'Donation', 'Payment', 'Registration', 'Membership', 'MonthlyDonation', 'MonthlyPayment', 'OfflineDonation',
  'Contribution', 'Bonus', 'Product',
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const orgSlug = z
  .string()
  .min(1)
  .optional()
  .describe('Organization slug (as in helloasso.com/associations/<slug>). Defaults to HELLOASSO_ORG_SLUG.');
const formType = z.enum(FORM_TYPES).describe('Form (campaign) type.');
const formSlug = z.string().min(1).describe('Form slug (as in the form URL).');
const date = (what: string) =>
  z
    .string()
    .regex(DATE_RE, 'Use an ISO 8601 date (YYYY-MM-DD) or date-time (YYYY-MM-DDThh:mm:ssZ).')
    .optional()
    .describe(what);

const pagination = {
  pageSize: z.number().int().min(1).max(100).optional().describe('Results per page (API default 20).'),
  pageIndex: z.number().int().min(1).optional().describe('Page number, starting at 1. Prefer continuationToken.'),
  continuationToken: z
    .string()
    .optional()
    .describe('Pass pagination.continuationToken from the previous result to get the next page.'),
};
const dateRange = {
  from: date('Start date filter (inclusive), ISO 8601.'),
  to: date('End date filter (exclusive), ISO 8601.'),
};
const userSearchKey = z.string().optional().describe('Filter on user or payer first name, last name or email.');
const sortOrder = z.enum(['Asc', 'Desc']).optional().describe('Sort order (API default Desc).');
const sortField = z.enum(['Date', 'UpdateDate', 'CreationDate']).optional().describe('Sort field (API default Date).');
const optionalForm = {
  formType: formType.optional().describe('Form type; give with formSlug to restrict to one form.'),
  formSlug: formSlug.optional().describe('Form slug; give with formType to restrict to one form.'),
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const enc = encodeURIComponent;

export function registerTools(server: McpServer, client: HelloAssoClient, config: Config): void {
  const org = (slug?: string): string => {
    const s = slug?.trim() || config.defaultOrgSlug;
    if (!s) throw new Error('No organization slug: pass orgSlug or set HELLOASSO_ORG_SLUG in the server environment.');
    return `/organizations/${enc(s)}`;
  };
  const scope = (a: { orgSlug?: string; formType?: string; formSlug?: string }): string => {
    if (!!a.formType !== !!a.formSlug) throw new Error('Give both formType and formSlug, or neither.');
    return a.formType ? `${org(a.orgSlug)}/forms/${enc(a.formType)}/${enc(a.formSlug!)}` : org(a.orgSlug);
  };
  const run = async (fn: () => Promise<unknown>): Promise<CallToolResult> => {
    try {
      return { content: [{ type: 'text', text: toCompactJson(await fn()) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: (err as Error).message }] };
    }
  };
  const get = (path: string, q?: Record<string, QueryValue>) => client.get(path, q);

  server.registerTool(
    'helloasso_get_organization',
    {
      title: 'Get organization',
      description: 'Public details of a HelloAsso organization (name, description, address, logo, URLs...).',
      inputSchema: { orgSlug },
      annotations: READ_ONLY,
    },
    async (a) => run(() => get(org(a.orgSlug))),
  );

  server.registerTool(
    'helloasso_list_my_organizations',
    {
      title: 'List my organizations',
      description: 'Organizations the API client has rights on (useful to find the organization slug).',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => run(() => get('/users/me/organizations')),
  );

  server.registerTool(
    'helloasso_list_form_types',
    {
      title: 'List form types',
      description: 'Form (campaign) types for which the organization has at least one form.',
      inputSchema: { orgSlug, states: z.array(z.enum(FORM_STATES)).optional().describe('Filter by form states.') },
      annotations: READ_ONLY,
    },
    async (a) => run(() => get(`${org(a.orgSlug)}/formTypes`, { states: a.states })),
  );

  server.registerTool(
    'helloasso_list_forms',
    {
      title: 'List forms / campaigns',
      description:
        'List the organization forms (campaigns): memberships, events, donations, shops, crowdfunding, payment forms. Newest first, paginated.',
      inputSchema: {
        orgSlug,
        formTypes: z.array(formType).optional().describe('Filter by form types, e.g. ["Membership"].'),
        states: z.array(z.enum(FORM_STATES)).optional().describe('Filter by form states, e.g. ["Public","Private"].'),
        ...pagination,
      },
      annotations: READ_ONLY,
    },
    async (a) =>
      run(() =>
        get(`${org(a.orgSlug)}/forms`, {
          formTypes: a.formTypes,
          states: a.states,
          pageIndex: a.pageIndex,
          pageSize: a.pageSize,
          continuationToken: a.continuationToken,
        }),
      ),
  );

  server.registerTool(
    'helloasso_get_form',
    {
      title: 'Get form',
      description: 'Public details of one form: title, dates, tiers (prices), custom fields, state, URL.',
      inputSchema: { orgSlug, formType, formSlug },
      annotations: READ_ONLY,
    },
    async (a) => run(() => get(`${scope(a)}/public`)),
  );

  server.registerTool(
    'helloasso_get_form_stats',
    {
      title: 'Get form statistics',
      description: 'Statistics of one form (amounts collected, number of orders/items...).',
      inputSchema: { orgSlug, formType, formSlug },
      annotations: READ_ONLY,
    },
    async (a) => run(() => get(`${scope(a)}/stats`)),
  );

  server.registerTool(
    'helloasso_list_orders',
    {
      title: 'List orders',
      description:
        'List orders of the organization, or of one form when formType + formSlug are given. Supports date range, search and pagination.',
      inputSchema: {
        orgSlug,
        ...optionalForm,
        ...dateRange,
        userSearchKey,
        formTypes: z.array(formType).optional().describe('Organization-wide only: filter by form types.'),
        withDetails: z.boolean().optional().describe('Include custom fields (API default false).'),
        sortOrder,
        ...pagination,
      },
      annotations: READ_ONLY,
    },
    async (a) =>
      run(() =>
        get(`${scope(a)}/orders`, {
          from: a.from,
          to: a.to,
          userSearchKey: a.userSearchKey,
          formTypes: a.formSlug ? undefined : a.formTypes,
          withDetails: a.withDetails,
          sortOrder: a.sortOrder,
          pageIndex: a.pageIndex,
          pageSize: a.pageSize,
          continuationToken: a.continuationToken,
        }),
      ),
  );

  server.registerTool(
    'helloasso_list_payments',
    {
      title: 'List payments',
      description:
        'List payments of the organization, or of one form when formType + formSlug are given. Supports date range, payment states, search, sorting and pagination.',
      inputSchema: {
        orgSlug,
        ...optionalForm,
        ...dateRange,
        userSearchKey,
        states: z.array(z.enum(PAYMENT_STATES)).optional().describe('Filter by payment states, e.g. ["Authorized"].'),
        sortOrder,
        sortField,
        ...pagination,
      },
      annotations: READ_ONLY,
    },
    async (a) =>
      run(() =>
        get(`${scope(a)}/payments`, {
          from: a.from,
          to: a.to,
          userSearchKey: a.userSearchKey,
          states: a.states,
          sortOrder: a.sortOrder,
          sortField: a.sortField,
          pageIndex: a.pageIndex,
          pageSize: a.pageSize,
          continuationToken: a.continuationToken,
        }),
      ),
  );

  server.registerTool(
    'helloasso_list_items',
    {
      title: 'List items (members, tickets, donations...)',
      description:
        'List items sold by the organization or by one form (formType + formSlug): e.g. the members of a membership campaign or the participants of an event, with custom fields answers.',
      inputSchema: {
        orgSlug,
        ...optionalForm,
        ...dateRange,
        userSearchKey,
        tierTypes: z.array(z.enum(TIER_TYPES)).optional().describe('Filter by tier types, e.g. ["Membership"].'),
        itemStates: z
          .array(z.enum(ITEM_STATES))
          .optional()
          .describe('Filter by item states, e.g. ["Processed","Registered"] for valid items.'),
        tierName: z.string().optional().describe('Filter by tier (price) name.'),
        withDetails: z
          .boolean()
          .default(true)
          .describe('Include custom fields and options (default true here; API default false).'),
        sortOrder,
        sortField,
        ...pagination,
      },
      annotations: READ_ONLY,
    },
    async (a) =>
      run(() =>
        get(`${scope(a)}/items`, {
          from: a.from,
          to: a.to,
          userSearchKey: a.userSearchKey,
          tierTypes: a.tierTypes,
          itemStates: a.itemStates,
          tierName: a.tierName,
          withDetails: a.withDetails ?? true,
          sortOrder: a.sortOrder,
          sortField: a.sortField,
          pageIndex: a.pageIndex,
          pageSize: a.pageSize,
          continuationToken: a.continuationToken,
        }),
      ),
  );

  server.registerTool(
    'helloasso_get_order',
    {
      title: 'Get order',
      description: 'Detailed order by id: payer, items, payments, amounts.',
      inputSchema: {
        orderId: z.number().int().positive().describe('Order id.'),
        withFormData: z.boolean().optional().describe('Include form data.'),
      },
      annotations: READ_ONLY,
    },
    async (a) => run(() => get(`/orders/${a.orderId}`, { withFormData: a.withFormData })),
  );

  server.registerTool(
    'helloasso_get_payment',
    {
      title: 'Get payment',
      description: 'Detailed payment by id: amount, state, payer, order, refund operations.',
      inputSchema: { paymentId: z.number().int().positive().describe('Payment id.') },
      annotations: READ_ONLY,
    },
    async (a) => run(() => get(`/payments/${a.paymentId}`)),
  );

  server.registerTool(
    'helloasso_get_item',
    {
      title: 'Get item',
      description: 'Detailed item (one membership, ticket, donation...) by id, with custom fields.',
      inputSchema: {
        itemId: z.number().int().positive().describe('Item id.'),
        withDetails: z.boolean().default(true).describe('Include custom fields and options (default true).'),
      },
      annotations: READ_ONLY,
    },
    async (a) => run(() => get(`/items/${a.itemId}`, { withDetails: a.withDetails ?? true })),
  );
}
