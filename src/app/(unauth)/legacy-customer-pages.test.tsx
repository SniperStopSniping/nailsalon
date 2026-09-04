import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LocaleAppointmentHistoryPage from '../[locale]/(unauth)/appointments/history/page';
import LocaleGalleryPage from '../[locale]/(unauth)/gallery/page';
import LocaleInvitePage from '../[locale]/(unauth)/invite/page';
import LocaleMembershipPage from '../[locale]/(unauth)/membership/page';
import LocaleMyReferralsPage from '../[locale]/(unauth)/my-referrals/page';
import LocalePaymentMethodsPage from '../[locale]/(unauth)/payment-methods/page';
import LocalePreferencesPage from '../[locale]/(unauth)/preferences/page';
import LocaleProfilePage from '../[locale]/(unauth)/profile/page';
import LocaleClaimReferralPage from '../[locale]/(unauth)/referral/[referralId]/page';
import LocaleRewardsPage from '../[locale]/(unauth)/rewards/page';
import TenantAppointmentHistoryPage from '../[locale]/[slug]/appointments/history/page';
import TenantGalleryPage from '../[locale]/[slug]/gallery/page';
import TenantInvitePage from '../[locale]/[slug]/invite/page';
import TenantMembershipPage from '../[locale]/[slug]/membership/page';
import TenantMyReferralsPage from '../[locale]/[slug]/my-referrals/page';
import TenantPaymentMethodsPage from '../[locale]/[slug]/payment-methods/page';
import TenantPreferencesPage from '../[locale]/[slug]/preferences/page';
import TenantProfilePage from '../[locale]/[slug]/profile/page';
import TenantClaimReferralPage from '../[locale]/[slug]/referral/[referralId]/page';
import TenantRewardsPage from '../[locale]/[slug]/rewards/page';
import AppointmentHistoryPage from './appointments/history/page';
import GalleryPage from './gallery/page';
import InvitePage from './invite/page';
import MembershipPage from './membership/page';
import MyReferralsPage from './my-referrals/page';
import PaymentMethodsPage from './payment-methods/page';
import PreferencesPage from './preferences/page';
import ProfilePage from './profile/page';
import ClaimReferralPage from './referral/[referralId]/page';
import RewardsPage from './rewards/page';

const {
  buildTenantRedirectPath,
  checkFeatureEnabled,
  fetchMock,
  getPublicPageContext,
  getTechniciansBySalonId,
  legacyContentRender,
  notFound,
  redirect,
} = vi.hoisted(() => ({
  buildTenantRedirectPath: vi.fn(),
  checkFeatureEnabled: vi.fn(),
  fetchMock: vi.fn(),
  getPublicPageContext: vi.fn(),
  getTechniciansBySalonId: vi.fn(),
  legacyContentRender: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound,
  redirect,
}));

vi.mock('@/components/PublicSalonPageShell', () => ({
  PublicSalonPageShell: () => null,
}));

vi.mock('@/libs/queries', () => ({
  getTechniciansBySalonId,
}));

vi.mock('@/libs/salonStatus', () => ({
  buildTenantRedirectPath,
  checkFeatureEnabled,
}));

vi.mock('@/libs/tenant', () => ({
  getPublicPageContext,
}));

vi.mock('./appointments/history/AppointmentHistoryContent', () => ({
  default: () => {
    legacyContentRender('AppointmentHistoryContent');
    return null;
  },
}));

vi.mock('./gallery/GalleryContent', () => ({
  default: () => {
    legacyContentRender('GalleryContent');
    return null;
  },
}));

vi.mock('./invite/InviteContent', () => ({
  default: () => {
    legacyContentRender('InviteContent');
    return null;
  },
}));

vi.mock('./membership/MembershipContent', () => ({
  default: () => {
    legacyContentRender('MembershipContent');
    return null;
  },
}));

vi.mock('./my-referrals/MyReferralsContent', () => ({
  default: () => {
    legacyContentRender('MyReferralsContent');
    return null;
  },
}));

vi.mock('./payment-methods/PaymentMethodsContent', () => ({
  default: () => {
    legacyContentRender('PaymentMethodsContent');
    return null;
  },
}));

vi.mock('./preferences/PreferencesContent', () => ({
  default: () => {
    legacyContentRender('PreferencesContent');
    return null;
  },
}));

vi.mock('./profile/ProfileContent', () => ({
  default: () => {
    legacyContentRender('ProfileContent');
    return null;
  },
}));

vi.mock('./rewards/RewardsContent', () => ({
  default: () => {
    legacyContentRender('RewardsContent');
    return null;
  },
}));

const NOT_FOUND_SENTINEL = new Error('legacy-customer-page:not-found');

const LEGACY_CONTENT_NAMES = [
  'AppointmentHistoryContent',
  'GalleryContent',
  'InviteContent',
  'MembershipContent',
  'MyReferralsContent',
  'PaymentMethodsContent',
  'PreferencesContent',
  'ProfileContent',
  'RewardsContent',
] as const;

type RetiredPage = () => unknown;

type RetiredRoute = {
  name: string;
  canonical: string;
  locale: string;
  tenant: string;
  Page: RetiredPage;
  LocalePage: RetiredPage;
  TenantPage: RetiredPage;
};

const RETIRED_ROUTES: RetiredRoute[] = [
  {
    name: 'appointment history',
    canonical: 'src/app/(unauth)/appointments/history/page.tsx',
    locale: 'src/app/[locale]/(unauth)/appointments/history/page.tsx',
    tenant: 'src/app/[locale]/[slug]/appointments/history/page.tsx',
    Page: AppointmentHistoryPage,
    LocalePage: LocaleAppointmentHistoryPage,
    TenantPage: TenantAppointmentHistoryPage,
  },
  {
    name: 'gallery',
    canonical: 'src/app/(unauth)/gallery/page.tsx',
    locale: 'src/app/[locale]/(unauth)/gallery/page.tsx',
    tenant: 'src/app/[locale]/[slug]/gallery/page.tsx',
    Page: GalleryPage,
    LocalePage: LocaleGalleryPage,
    TenantPage: TenantGalleryPage,
  },
  {
    name: 'invite',
    canonical: 'src/app/(unauth)/invite/page.tsx',
    locale: 'src/app/[locale]/(unauth)/invite/page.tsx',
    tenant: 'src/app/[locale]/[slug]/invite/page.tsx',
    Page: InvitePage,
    LocalePage: LocaleInvitePage,
    TenantPage: TenantInvitePage,
  },
  {
    name: 'membership',
    canonical: 'src/app/(unauth)/membership/page.tsx',
    locale: 'src/app/[locale]/(unauth)/membership/page.tsx',
    tenant: 'src/app/[locale]/[slug]/membership/page.tsx',
    Page: MembershipPage,
    LocalePage: LocaleMembershipPage,
    TenantPage: TenantMembershipPage,
  },
  {
    name: 'my referrals',
    canonical: 'src/app/(unauth)/my-referrals/page.tsx',
    locale: 'src/app/[locale]/(unauth)/my-referrals/page.tsx',
    tenant: 'src/app/[locale]/[slug]/my-referrals/page.tsx',
    Page: MyReferralsPage,
    LocalePage: LocaleMyReferralsPage,
    TenantPage: TenantMyReferralsPage,
  },
  {
    name: 'payment methods',
    canonical: 'src/app/(unauth)/payment-methods/page.tsx',
    locale: 'src/app/[locale]/(unauth)/payment-methods/page.tsx',
    tenant: 'src/app/[locale]/[slug]/payment-methods/page.tsx',
    Page: PaymentMethodsPage,
    LocalePage: LocalePaymentMethodsPage,
    TenantPage: TenantPaymentMethodsPage,
  },
  {
    name: 'preferences',
    canonical: 'src/app/(unauth)/preferences/page.tsx',
    locale: 'src/app/[locale]/(unauth)/preferences/page.tsx',
    tenant: 'src/app/[locale]/[slug]/preferences/page.tsx',
    Page: PreferencesPage,
    LocalePage: LocalePreferencesPage,
    TenantPage: TenantPreferencesPage,
  },
  {
    name: 'profile',
    canonical: 'src/app/(unauth)/profile/page.tsx',
    locale: 'src/app/[locale]/(unauth)/profile/page.tsx',
    tenant: 'src/app/[locale]/[slug]/profile/page.tsx',
    Page: ProfilePage,
    LocalePage: LocaleProfilePage,
    TenantPage: TenantProfilePage,
  },
  {
    name: 'referral claim',
    canonical: 'src/app/(unauth)/referral/[referralId]/page.tsx',
    locale: 'src/app/[locale]/(unauth)/referral/[referralId]/page.tsx',
    tenant: 'src/app/[locale]/[slug]/referral/[referralId]/page.tsx',
    Page: ClaimReferralPage,
    LocalePage: LocaleClaimReferralPage,
    TenantPage: TenantClaimReferralPage,
  },
  {
    name: 'rewards',
    canonical: 'src/app/(unauth)/rewards/page.tsx',
    locale: 'src/app/[locale]/(unauth)/rewards/page.tsx',
    tenant: 'src/app/[locale]/[slug]/rewards/page.tsx',
    Page: RewardsPage,
    LocalePage: LocaleRewardsPage,
    TenantPage: TenantRewardsPage,
  },
];

const RETIRED_ROUTE_REFERENCE_PATTERN
  = /["'`](?:\/(?:[a-z]{2}|\$\{[^}]+\})(?:\/(?:[a-z0-9-]+|\$\{[^}]+\}))?)?(?:\/appointments\/history|\/gallery|\/invite|\/membership|\/my-referrals|\/payment-methods|\/preferences|\/profile|\/referral|\/rewards)(?=[/?#"'`\s]|$)/;

const ALLOWED_RETIRED_RUNTIME_ROUTE_REFERENCES = new Map([
  [
    'src/app/(unauth)/change-appointment/ChangeAppointmentContent.tsx',
    'retained behind the retired change-appointment canonical page',
  ],
  [
    'src/app/(unauth)/invite/InviteContent.tsx',
    'retained legacy customer content',
  ],
  [
    'src/app/(unauth)/membership/MembershipContent.tsx',
    'retained legacy customer content',
  ],
  [
    'src/app/(unauth)/my-referrals/MyReferralsContent.tsx',
    'retained legacy customer content',
  ],
  [
    'src/app/(unauth)/payment-methods/PaymentMethodsContent.tsx',
    'retained legacy customer content',
  ],
  [
    'src/app/(unauth)/preferences/PreferencesContent.tsx',
    'retained legacy customer content',
  ],
  [
    'src/app/(unauth)/profile/ProfileContent.tsx',
    'retained legacy customer content',
  ],
  [
    'src/app/(unauth)/rewards/RewardsContent.tsx',
    'retained legacy customer content',
  ],
  [
    'src/app/api/referrals/generate/route.ts',
    'legacy referral producer fails closed at the retired client API guard',
  ],
  [
    'src/components/booking/BookingFloatingDock.tsx',
    'retained component with no active runtime importer',
  ],
  [
    'src/libs/SMS.ts',
    'historical referral SMS reached only from a guarded legacy referral API',
  ],
]);

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

function expectedReExport(wrapperPath: string, canonicalPath: string): string {
  let target = relative(dirname(wrapperPath), canonicalPath)
    .replaceAll('\\', '/')
    .replace(/\.tsx$/, '');

  if (!target.startsWith('.')) {
    target = `./${target}`;
  }

  return `export { default } from '${target}';`;
}

function trackedRuntimeSourceFiles(): string[] {
  return execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
    .split('\n')
    .filter(file => /\.[cm]?[jt]sx?$/.test(file))
    .filter(file => !/\.(?:test|spec|stories)\.[cm]?[jt]sx?$/.test(file));
}

function findMatchingLines(
  files: string[],
  predicate: (line: string) => boolean,
): Array<{ file: string; line: number; source: string }> {
  return files.flatMap(file =>
    readSource(file)
      .split('\n')
      .flatMap((source, index) =>
        predicate(source)
          ? [{ file, line: index + 1, source: source.trim() }]
          : [],
      ),
  );
}

function referencesLegacyContent(source: string, contentName: string): boolean {
  // Match an imported/rendered component identifier or its module path, not
  // an unrelated identifier such as syncSharedSalonProfileContent.
  return new RegExp(`\\b${contentName}\\b`).test(source);
}

describe('retired legacy customer pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    notFound.mockImplementation(() => {
      throw NOT_FOUND_SENTINEL;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(RETIRED_ROUTES)(
    '$name immediately calls notFound without loading legacy customer state',
    ({ canonical, Page }) => {
      expect(() => Page()).toThrow(NOT_FOUND_SENTINEL);

      expect(notFound).toHaveBeenCalledOnce();
      expect(redirect).not.toHaveBeenCalled();
      expect(getPublicPageContext).not.toHaveBeenCalled();
      expect(getTechniciansBySalonId).not.toHaveBeenCalled();
      expect(checkFeatureEnabled).not.toHaveBeenCalled();
      expect(buildTenantRedirectPath).not.toHaveBeenCalled();
      expect(legacyContentRender).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();

      const source = readSource(canonical);

      expect(source).toMatch(/^import \{ notFound \} from 'next\/navigation';/);
      expect(source).toMatch(
        /export default function \w+\(\) \{\s*notFound\(\);\s*\}/,
      );

      for (const contentName of LEGACY_CONTENT_NAMES) {
        expect(source).not.toContain(contentName);
      }

      for (const retiredLoader of [
        'PublicSalonPageShell',
        'getPublicPageContext',
        'getTechniciansBySalonId',
        'checkFeatureEnabled',
        'buildTenantRedirectPath',
        'useParams',
        'useRouter',
        'fetch(',
        'redirect(',
      ]) {
        expect(source).not.toContain(retiredLoader);
      }
    },
  );

  it.each(RETIRED_ROUTES)(
    '$name locale wrappers are exact re-exports of the canonical page',
    ({
      canonical,
      locale,
      tenant,
      Page,
      LocalePage,
      TenantPage,
    }) => {
      expect(LocalePage).toBe(Page);
      expect(TenantPage).toBe(Page);
      expect(readSource(locale).trim()).toBe(expectedReExport(locale, canonical));
      expect(readSource(tenant).trim()).toBe(expectedReExport(tenant, canonical));
    },
  );

  it('retires referral claims before inspecting parameters or exposing claim UI', () => {
    const parameterRead = vi.fn();
    const poisonParams = new Proxy(
      {
        referralId: 'synthetic-private-referral-id',
      },
      {
        get(target, property, receiver) {
          parameterRead(property);
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const invokeWithRouteProps = ClaimReferralPage as unknown as (
      props: { params: object },
    ) => unknown;

    expect(() => invokeWithRouteProps({ params: poisonParams })).toThrow(
      NOT_FOUND_SENTINEL,
    );

    expect(parameterRead).not.toHaveBeenCalled();
    expect(notFound).toHaveBeenCalledOnce();
    expect(redirect).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(legacyContentRender).not.toHaveBeenCalled();

    const referralSource = readSource(
      'src/app/(unauth)/referral/[referralId]/page.tsx',
    );

    expect(referralSource).not.toMatch(/^['"]use client['"]/);
    expect(referralSource).not.toMatch(
      /\b(?:referralId|phone|code|name|useParams|useRouter)\b/,
    );
    expect(referralSource).not.toContain('/api/');
    expect(referralSource).not.toContain('fetch(');
    expect(referralSource).not.toContain('<input');
    expect(referralSource).not.toContain('<form');
    expect(referralSource).not.toContain('ConfettiPopup');
  });

  it('allows retired route references only in explicit unreachable legacy code', () => {
    const runtimeFiles = trackedRuntimeSourceFiles();
    const retiredReferences = findMatchingLines(
      runtimeFiles,
      line => RETIRED_ROUTE_REFERENCE_PATTERN.test(line),
    );
    const unexpectedReferences = retiredReferences.filter(
      reference => !ALLOWED_RETIRED_RUNTIME_ROUTE_REFERENCES.has(reference.file),
    );

    expect(
      unexpectedReferences,
      'An active runtime source points to a retired customer page',
    ).toEqual([]);

    const unexpectedLegacyContentReferences = runtimeFiles.flatMap((file) => {
      const source = readSource(file);

      return LEGACY_CONTENT_NAMES
        .filter(contentName => referencesLegacyContent(source, contentName))
        .filter(contentName => !file.endsWith(`/${contentName}.tsx`))
        .map(contentName => ({ file, contentName }));
    });

    expect(
      unexpectedLegacyContentReferences,
      'A runtime source imports or renders retained legacy customer content',
    ).toEqual([]);
  });

  it('detects legacy component imports and renders without matching unrelated identifiers', () => {
    expect(referencesLegacyContent('import Renamed from "./profile/ProfileContent";', 'ProfileContent')).toBe(true);
    expect(referencesLegacyContent('<ProfileContent />', 'ProfileContent')).toBe(true);
    expect(referencesLegacyContent('async function syncSharedSalonProfileContent() {}', 'ProfileContent')).toBe(false);
  });

  it('keeps booking, shared navigation, manage links, and recovery free of retired pages', () => {
    const runtimeFiles = trackedRuntimeSourceFiles();
    const activeBookingFiles = runtimeFiles.filter(file =>
      file.startsWith('src/app/(unauth)/book/')
      || file.startsWith('src/components/booking/'),
    );
    const retiredPageImportPattern
      = /(?:appointments\/history|gallery|invite|membership|my-referrals|payment-methods|preferences|profile|referral\/\[referralId\]|rewards)\/page(?:['"]|$)/;
    const retiredContentImportPattern = new RegExp(
      LEGACY_CONTENT_NAMES.join('|'),
    );

    expect(findMatchingLines(
      activeBookingFiles,
      line =>
        retiredPageImportPattern.test(line)
        || retiredContentImportPattern.test(line),
    )).toEqual([]);

    const activeSharedFlowFiles = runtimeFiles.filter(file =>
      file !== 'src/components/booking/BookingFloatingDock.tsx',
    );

    expect(findMatchingLines(
      activeSharedFlowFiles,
      line =>
        line.includes('@/components/booking/BookingFloatingDock')
        || line.includes('/BookingFloatingDock'),
    )).toEqual([]);
  });

  it('keeps historical referral link producers behind the retired client guard', () => {
    const generateSource = readSource('src/app/api/referrals/generate/route.ts');
    const sendSource = readSource('src/app/api/referrals/send/route.ts');

    expect(generateSource.indexOf('await requireClientApiSession()')).toBeGreaterThan(-1);
    expect(generateSource.indexOf('await requireClientApiSession()')).toBeLessThan(
      generateSource.indexOf('buildSalonPublicUrl(`/referral/'),
    );
    expect(sendSource.indexOf('await requireClientApiSession()')).toBeGreaterThan(-1);
    expect(sendSource.indexOf('await requireClientApiSession()')).toBeLessThan(
      sendSource.indexOf('sendReferralInvite('),
    );
  });
});
