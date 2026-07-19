import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('../src/auth.js', () => ({ authenticate: mocks.authenticate }));
vi.mock('../src/db.js', () => ({
  prisma: { user: { findUnique: mocks.findUnique } },
}));

import {
  configuredSystemAdminUserIds,
  isSystemAdminRecord,
  requireSystemAdmin,
} from '../src/admin-auth.js';

beforeEach(() => vi.clearAllMocks());

describe('system administrator authorization', () => {
  it('normalizes an explicit bootstrap allowlist', () => {
    expect([...configuredSystemAdminUserIds(' user_admin_a,user_admin_b, ')]).toEqual([
      'user_admin_a',
      'user_admin_b',
    ]);
  });

  it('requires an active server-side capability rather than a product role', () => {
    expect(isSystemAdminRecord(
      { id: 'host-a', status: 'ACTIVE', isSystemAdmin: false },
      new Set(),
    )).toBe(false);
    expect(isSystemAdminRecord(
      { id: 'admin-a', status: 'ACTIVE', isSystemAdmin: true },
      new Set(),
    )).toBe(true);
    expect(isSystemAdminRecord(
      { id: 'bootstrap-user', status: 'ACTIVE', isSystemAdmin: false },
      new Set(['bootstrap-user']),
    )).toBe(true);
    expect(isSystemAdminRecord(
      { id: 'new-registration', status: 'ACTIVE', isSystemAdmin: false },
      new Set(['deleted-account-id']),
    )).toBe(false);
    expect(isSystemAdminRecord(
      { id: 'admin-a', status: 'DISABLED', isSystemAdmin: true },
      new Set(['admin-a']),
    )).toBe(false);
  });

  it('rejects Guest tokens before querying a user capability', async () => {
    mocks.authenticate.mockImplementation(async (request) => {
      request.auth = { subjectId: 'guest-a', role: 'GUEST' };
    });
    await expect(requireSystemAdmin({} as never, {} as never)).rejects.toMatchObject({
      statusCode: 403,
      code: 'SYSTEM_ADMIN_REQUIRED',
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('re-reads the active database flag on every request', async () => {
    mocks.authenticate.mockImplementation(async (request) => {
      request.auth = { subjectId: 'user-a', role: 'USER' };
    });
    mocks.findUnique.mockResolvedValueOnce({
      status: 'ACTIVE',
      isSystemAdmin: false,
      id: 'user-a',
    });
    await expect(requireSystemAdmin({} as never, {} as never)).rejects.toMatchObject({
      code: 'SYSTEM_ADMIN_REQUIRED',
    });

    mocks.findUnique.mockResolvedValueOnce({
      status: 'ACTIVE',
      isSystemAdmin: true,
      id: 'user-a',
    });
    await expect(requireSystemAdmin({} as never, {} as never)).resolves.toBeUndefined();
    expect(mocks.findUnique).toHaveBeenCalledTimes(2);
  });
});
