import path from 'node:path';

const DEFAULT_LOCALE = process.env.E2E_LOCALE || 'en';
const APP_DEFAULT_LOCALE = 'en';
const DEFAULT_SALON_SLUG = process.env.E2E_SALON_SLUG || 'nail-salon-no5';
const HOST = process.env.HOST || 'localhost';
const PORT = process.env.PORT || '3000';
const EXTERNAL_BASE_URL = process.env.E2E_BASE_URL?.trim();

export const e2eConfig = {
  locale: DEFAULT_LOCALE,
  salonSlug: DEFAULT_SALON_SLUG,
  salonName: process.env.E2E_SALON_NAME || 'Nail Salon No.5',
  serviceId: process.env.E2E_SERVICE_ID || 'svc_biab-short',
  serviceName: process.env.E2E_SERVICE_NAME || 'BIAB Short',
  serviceDurationMinutes: Number.parseInt(process.env.E2E_SERVICE_DURATION_MINUTES || '75', 10),
  customerOtpCode: process.env.E2E_CUSTOMER_OTP_CODE || process.env.E2E_OTP_CODE || '123456',
  staffPhone: process.env.E2E_STAFF_PHONE || '4165550201',
  staffOtpCode: process.env.E2E_STAFF_OTP_CODE || process.env.E2E_OTP_CODE || '123456',
  superAdminPhone: process.env.E2E_SUPER_ADMIN_PHONE || '4165550101',
  superAdminOtpCode: process.env.E2E_SUPER_ADMIN_OTP_CODE || process.env.E2E_ADMIN_OTP_CODE || process.env.E2E_OTP_CODE || '123456',
  staffTechnicianName: process.env.E2E_STAFF_TECH_NAME || 'Daniela',
};

export const e2eBaseUrl = EXTERNAL_BASE_URL || `http://${HOST}:${PORT}`;

export const authStatePaths = {
  staff: path.join(process.cwd(), 'tests/e2e/.auth/staff.json'),
  superAdmin: path.join(process.cwd(), 'tests/e2e/.auth/super-admin.json'),
};

export function usingExternalBaseUrl() {
  return Boolean(EXTERNAL_BASE_URL);
}

export function appPath(pathname: string) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (DEFAULT_LOCALE === APP_DEFAULT_LOCALE) {
    return normalizedPath;
  }

  return `/${DEFAULT_LOCALE}${normalizedPath}`;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function appPathPattern(pathname: string) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const trimmedPath = normalizedPath.replace(/^\//, '');

  if (DEFAULT_LOCALE === APP_DEFAULT_LOCALE) {
    return new RegExp(`/(?:${APP_DEFAULT_LOCALE}/)?${escapeRegex(trimmedPath)}(?:\\?|$)`);
  }

  return new RegExp(`${escapeRegex(`/${DEFAULT_LOCALE}${normalizedPath}`)}(?:\\?|$)`);
}

export function uniqueCustomerPhone() {
  const suffix = `${Date.now()}`.slice(-4);
  return `416555${suffix}`;
}

export function formatE2EPhoneE164(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  throw new Error(`Invalid E2E phone number: ${phone}`);
}
