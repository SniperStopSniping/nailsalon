import { createLabServiceMenuPort } from '../lab/service-menu-port';

/**
 * Replace this binding with the authenticated owner-menu adapter during
 * Production integration. Screens import this seam, never the Lab fixture.
 */
export const serviceMenuPort = createLabServiceMenuPort();
