import 'server-only';

import { type AdminWithSalons, requireSuperAdmin } from './adminAuth';
import { areSuperAdminTestToolsEnabled } from './authConfig.server';

export type TestToolsGuard =
  | { ok: true; admin: AdminWithSalons }
  | { ok: false; response: Response };

export async function requireSuperAdminTestTools(): Promise<TestToolsGuard> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return auth;
  }
  if (!areSuperAdminTestToolsEnabled()) {
    return {
      ok: false,
      response: Response.json(
        { error: { code: 'TEST_TOOLS_DISABLED', message: 'Testing tools are disabled' } },
        { status: 403 },
      ),
    };
  }
  return { ok: true, admin: auth.admin };
}
