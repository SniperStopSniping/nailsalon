import { createServiceTemplateMenuPort } from '../lab/service-menu-port';

/**
 * Read-only access to the shared Product template library. Tenant-owned rows
 * are resolved only by the authenticated claim; this never reads another
 * owner's menu or replaces their custom services with template defaults.
 */
export const serviceMenuPort = createServiceTemplateMenuPort();
