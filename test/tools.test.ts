import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { jsonResponse, mockFetch, tokenOk, type Recorded } from './helpers.js';

const BASE = 'https://api.helloasso-sandbox.com/v5';
let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function setup(handlers: Parameters<typeof mockFetch>[0], env: Record<string, string> = {}) {
  const m = mockFetch([tokenOk('TOKEN'), ...handlers]);
  const config = loadConfig({
    HELLOASSO_CLIENT_ID: 'id',
    HELLOASSO_CLIENT_SECRET: 'secret',
    HELLOASSO_ORG_SLUG: 'my-association',
    ...env,
  });
  const server = createServer({ config, fetch: m.fetch });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return m;
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client!.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ type: string; text: string }>;
  };
  return { isError: !!res.isError, text: res.content[0].text };
}

function apiCall(calls: Recorded[]) {
  const u = new URL(calls[calls.length - 1].url);
  return { path: u.pathname.replace('/v5', ''), q: u.searchParams, origin: u.origin };
}

const page = (data: unknown[], continuationToken = 'NEXT') => () =>
  jsonResponse(200, { data, pagination: { pageSize: 20, totalCount: 42, pageIndex: 1, totalPages: 3, continuationToken } });

describe('tools/list', () => {
  it('exposes only read-only tools', async () => {
    await setup([]);
    const { tools } = await client!.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'helloasso_get_form',
      'helloasso_get_form_stats',
      'helloasso_get_item',
      'helloasso_get_order',
      'helloasso_get_organization',
      'helloasso_get_payment',
      'helloasso_list_form_types',
      'helloasso_list_forms',
      'helloasso_list_items',
      'helloasso_list_my_organizations',
      'helloasso_list_orders',
      'helloasso_list_payments',
    ]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
  });
});

describe('tools', () => {
  it('get_organization uses the default org slug and returns compact JSON', async () => {
    const m = await setup([() => jsonResponse(200, { name: 'My Association', organizationSlug: 'my-association', logo: null })]);
    const r = await call('helloasso_get_organization');
    expect(r.isError).toBe(false);
    expect(apiCall(m.calls).path).toBe('/organizations/my-association');
    expect(apiCall(m.calls).origin).toBe('https://api.helloasso-sandbox.com');
    expect(r.text).toBe('{"name":"My Association","organizationSlug":"my-association"}');
  });

  it('an explicit orgSlug overrides the default and is URL-encoded', async () => {
    const m = await setup([() => jsonResponse(200, {})]);
    await call('helloasso_get_organization', { orgSlug: 'other association' });
    expect(m.calls[1].url).toBe(`${BASE}/organizations/other%20association`);
  });

  it('errors clearly without any org slug', async () => {
    await setup([], { HELLOASSO_ORG_SLUG: '' });
    const r = await call('helloasso_get_organization');
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/HELLOASSO_ORG_SLUG/);
  });

  it('list_forms passes type/state filters and pagination', async () => {
    const m = await setup([page([{ formSlug: 'membership-2026', formType: 'Membership' }])]);
    const r = await call('helloasso_list_forms', {
      formTypes: ['Membership'],
      states: ['Public', 'Private'],
      pageSize: 50,
      continuationToken: 'abc',
    });
    const { path, q } = apiCall(m.calls);
    expect(path).toBe('/organizations/my-association/forms');
    expect(q.getAll('formTypes')).toEqual(['Membership']);
    expect(q.getAll('states')).toEqual(['Public', 'Private']);
    expect(q.get('pageSize')).toBe('50');
    expect(q.get('continuationToken')).toBe('abc');
    const json = JSON.parse(r.text);
    expect(json.data).toHaveLength(1);
    expect(json.pagination.continuationToken).toBe('NEXT');
  });

  it('list_forms rejects an unknown form type', async () => {
    await setup([]);
    const r = await call('helloasso_list_forms', { formTypes: ['Raffle'] });
    expect(r.isError).toBe(true);
  });

  it('list_form_types', async () => {
    const m = await setup([() => jsonResponse(200, ['Membership', 'Donation'])]);
    const r = await call('helloasso_list_form_types', { states: ['Public'] });
    expect(apiCall(m.calls).path).toBe('/organizations/my-association/formTypes');
    expect(apiCall(m.calls).q.getAll('states')).toEqual(['Public']);
    expect(JSON.parse(r.text)).toEqual(['Membership', 'Donation']);
  });

  it('get_form uses the public form endpoint', async () => {
    const m = await setup([() => jsonResponse(200, { title: 'Membership 2026' })]);
    await call('helloasso_get_form', { formType: 'Membership', formSlug: 'membership-2026' });
    expect(apiCall(m.calls).path).toBe('/organizations/my-association/forms/Membership/membership-2026/public');
  });

  it('get_form_stats', async () => {
    const m = await setup([() => jsonResponse(200, {})]);
    await call('helloasso_get_form_stats', { formType: 'Event', formSlug: 'summer-party' });
    expect(apiCall(m.calls).path).toBe('/organizations/my-association/forms/Event/summer-party/stats');
  });

  it('list_orders for the organization with filters', async () => {
    const m = await setup([page([])]);
    await call('helloasso_list_orders', {
      from: '2026-01-01',
      to: '2026-02-01T00:00:00Z',
      formTypes: ['Event'],
      userSearchKey: 'doe',
      withDetails: true,
      sortOrder: 'Asc',
      pageIndex: 2,
    });
    const { path, q } = apiCall(m.calls);
    expect(path).toBe('/organizations/my-association/orders');
    expect(q.get('from')).toBe('2026-01-01');
    expect(q.get('to')).toBe('2026-02-01T00:00:00Z');
    expect(q.getAll('formTypes')).toEqual(['Event']);
    expect(q.get('userSearchKey')).toBe('doe');
    expect(q.get('withDetails')).toBe('true');
    expect(q.get('sortOrder')).toBe('Asc');
    expect(q.get('pageIndex')).toBe('2');
  });

  it('list_orders for a form', async () => {
    const m = await setup([page([])]);
    await call('helloasso_list_orders', { formType: 'Membership', formSlug: 'membership-2026' });
    expect(apiCall(m.calls).path).toBe('/organizations/my-association/forms/Membership/membership-2026/orders');
  });

  it('list_orders requires formType and formSlug together', async () => {
    await setup([]);
    const r = await call('helloasso_list_orders', { formSlug: 'membership-2026' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/formType/);
  });

  it('rejects invalid dates', async () => {
    await setup([]);
    const r = await call('helloasso_list_payments', { from: 'last week' });
    expect(r.isError).toBe(true);
  });

  it('list_payments for the organization with states and sorting', async () => {
    const m = await setup([page([{ id: 1, amount: 5000 }])]);
    await call('helloasso_list_payments', {
      from: '2026-01-01',
      states: ['Authorized', 'Refunded'],
      sortField: 'UpdateDate',
      sortOrder: 'Desc',
    });
    const { path, q } = apiCall(m.calls);
    expect(path).toBe('/organizations/my-association/payments');
    expect(q.getAll('states')).toEqual(['Authorized', 'Refunded']);
    expect(q.get('sortField')).toBe('UpdateDate');
  });

  it('list_payments for a form', async () => {
    const m = await setup([page([])]);
    await call('helloasso_list_payments', { formType: 'Donation', formSlug: 'donate' });
    expect(apiCall(m.calls).path).toBe('/organizations/my-association/forms/Donation/donate/payments');
  });

  it('list_items for a form defaults withDetails=true (custom fields)', async () => {
    const m = await setup([page([{ id: 7, name: 'Adult membership', customFields: [{ name: 'Licence', answer: '123' }] }])]);
    const r = await call('helloasso_list_items', {
      formType: 'Membership',
      formSlug: 'membership-2026',
      itemStates: ['Processed'],
      tierTypes: ['Membership'],
      tierName: 'Adult',
    });
    const { path, q } = apiCall(m.calls);
    expect(path).toBe('/organizations/my-association/forms/Membership/membership-2026/items');
    expect(q.get('withDetails')).toBe('true');
    expect(q.getAll('itemStates')).toEqual(['Processed']);
    expect(q.getAll('tierTypes')).toEqual(['Membership']);
    expect(q.get('tierName')).toBe('Adult');
    expect(JSON.parse(r.text).data[0].customFields[0].answer).toBe('123');
  });

  it('list_items for the organization', async () => {
    const m = await setup([page([])]);
    await call('helloasso_list_items', { withDetails: false });
    expect(apiCall(m.calls).path).toBe('/organizations/my-association/items');
    expect(apiCall(m.calls).q.get('withDetails')).toBe('false');
  });

  it('get_order / get_payment / get_item by id', async () => {
    const m = await setup([
      () => jsonResponse(200, { id: 11 }),
      () => jsonResponse(200, { id: 22 }),
      () => jsonResponse(200, { id: 33 }),
    ]);
    await call('helloasso_get_order', { orderId: 11, withFormData: true });
    expect(apiCall(m.calls).path).toBe('/orders/11');
    expect(apiCall(m.calls).q.get('withFormData')).toBe('true');
    await call('helloasso_get_payment', { paymentId: 22 });
    expect(apiCall(m.calls).path).toBe('/payments/22');
    await call('helloasso_get_item', { itemId: 33 });
    expect(apiCall(m.calls).path).toBe('/items/33');
    expect(apiCall(m.calls).q.get('withDetails')).toBe('true');
  });

  it('list_my_organizations', async () => {
    const m = await setup([() => jsonResponse(200, [{ organizationSlug: 'my-association' }])]);
    await call('helloasso_list_my_organizations');
    expect(apiCall(m.calls).path).toBe('/users/me/organizations');
  });

  it('surfaces API errors as tool errors (403)', async () => {
    await setup([() => jsonResponse(403, {})]);
    const r = await call('helloasso_list_orders');
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/403/);
  });

  it('uses production URLs when configured', async () => {
    const m = await setup([() => jsonResponse(200, {})], { HELLOASSO_ENV: 'production' });
    await call('helloasso_get_organization');
    expect(m.calls[0].url).toBe('https://api.helloasso.com/oauth2/token');
    expect(m.calls[1].url).toBe('https://api.helloasso.com/v5/organizations/my-association');
  });
});
