import type { OrgPermission, OrgRole } from '@/types/Auth';

// Keep translation keys type-safe with the next-intl v4 augmentation API.
type Messages = typeof import('../locales/en.json');

declare module 'next-intl' {
  // eslint-disable-next-line ts/consistent-type-definitions
  interface AppConfig {
    Messages: Messages;
  }
}

declare global {
  // eslint-disable-next-line ts/consistent-type-definitions
  interface ClerkAuthorization {
    permission: OrgPermission;
    role: OrgRole;
  }
}
