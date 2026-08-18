import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// Denied RBAC requests call lib/audit.logAction; mock it so a 403 in these
// tests never writes to a real audit_log or a checked-in fixture file.
const { logAction } = vi.hoisted(() => ({ logAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/audit', () => ({ logAction }));

// server.ts computes IS_MOCK from these at import time; force mock mode so
// this suite never depends on (or risks touching) a real DB/AWS.
delete process.env.DATABASE_URL;
delete process.env.COCKROACH_DATABASE_URL;
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_PROFILE;

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  // `router` is exported specifically for this: import doesn't auto-listen
  // under vitest (see the `!process.env.VITEST` guard in server.ts), so we
  // drive it over our own ephemeral-port server instead of the module's own.
  const { router } = await import('../services/api/server');
  server = http.createServer((req, res) => { void router(req, res); });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

function get(path: string, role?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: role ? { 'X-Fiscus-Role': role } : {} });
}

describe('GET /org', () => {
  it('returns the demo org in mock mode', async () => {
    const res = await get('/org');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('00000000-0000-0000-0000-000000000001');
    expect(typeof body.name).toBe('string');
  });
});

describe('GET /volunteers', () => {
  it('returns exactly the four seeded roles', async () => {
    const res = await get('/volunteers');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(4);
    expect(body.map((v: { role: string }) => v.role).sort()).toEqual(
      ['data_entry', 'leadership', 'reviewer', 'treasurer'],
    );
  });
});

describe('GET /documents', () => {
  it('returns an array of documents', async () => {
    const res = await get('/documents');
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});

describe('GET /templates', () => {
  it('maps schema_json into fields[] with a matching field_count', async () => {
    const res = await get('/templates');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    for (const tpl of body) {
      expect(tpl).toHaveProperty('field_count');
      expect(tpl).toHaveProperty('fields');
      expect(tpl.field_count).toBe(tpl.fields.length);
    }
  });
});

describe('RBAC — GET /summary requires view_aggregate_reports', () => {
  it('allows treasurer and leadership through to aggregate numbers', async () => {
    for (const role of ['treasurer', 'leadership']) {
      const res = await get('/summary', role);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('total_spend_cents');
      expect(body).toHaveProperty('by_category');
      expect(body).toHaveProperty('monthly_spend_cents');
    }
  });

  it('forbids data_entry and reviewer, and audits each denial', async () => {
    logAction.mockClear();
    for (const role of ['data_entry', 'reviewer']) {
      const res = await get('/summary', role);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe('forbidden');
    }
    expect(logAction).toHaveBeenCalledTimes(2);
    expect(logAction).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), 'access_denied', 'transactions', expect.any(String),
      expect.objectContaining({ capability: 'view_aggregate_reports' }),
    );
  });
});

describe('RBAC — GET /search requires view_row_level_transactions', () => {
  it('forbids leadership (aggregate-only role) from row-level search', async () => {
    const res = await get('/search?q=vet', 'leadership');
    expect(res.status).toBe(403);
  });

  it('allows treasurer', async () => {
    const res = await get('/search?q=vet', 'treasurer');
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});

describe('CORS', () => {
  it('echoes an allow-listed origin back on a normal request', async () => {
    const res = await fetch(`${baseUrl}/org`, { headers: { Origin: 'https://fiscus-blue.vercel.app' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://fiscus-blue.vercel.app');
  });

  it('does not echo an unlisted origin', async () => {
    const res = await fetch(`${baseUrl}/org`, { headers: { Origin: 'https://evil.example.com' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers an OPTIONS preflight with 204', async () => {
    const res = await fetch(`${baseUrl}/org`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
  });
});

describe('Unknown routes', () => {
  it('404s with an error payload naming the method and path', async () => {
    const res = await get('/does-not-exist');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('not found');
  });
});
