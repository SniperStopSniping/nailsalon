import { fileURLToPath } from 'node:url';

import withBundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';
import createJiti from 'jiti';
import withNextIntl from 'next-intl/plugin';

const jiti = createJiti(fileURLToPath(import.meta.url));

jiti('./src/libs/Env');
const packageJson = jiti('./package.json');
const {
  assertProductionSentryBuildEnv,
  getPublicSentryRuntimeEnv,
  resolveSentryEnvironment,
  resolveSentryRelease,
  shouldEnableSentryWebpackPlugin,
} = jiti('./src/libs/sentry/build.ts');

const withNextIntlConfig = withNextIntl('./src/libs/i18n.ts');

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const sentryRelease = resolveSentryRelease(process.env, packageJson.version);
const sentryEnvironment = resolveSentryEnvironment(process.env);
const sentryPublicRuntimeEnv = getPublicSentryRuntimeEnv(process.env, packageJson.version);
const shouldEnableSentryPlugin = shouldEnableSentryWebpackPlugin(process.env);
const isProductionBuild = process.env.NODE_ENV === 'production';

if (isProductionBuild) {
  assertProductionSentryBuildEnv(process.env);
}

/** @type {import('next').NextConfig} */
const nextConfig = bundleAnalyzer(
  withNextIntlConfig({
    eslint: {
      dirs: ['.'],
    },
    images: {
      remotePatterns: [
        {
          protocol: 'https',
          hostname: 'res.cloudinary.com',
          pathname: '/**',
        },
      ],
    },
    env: {
      NEXT_PUBLIC_SENTRY_RELEASE: sentryPublicRuntimeEnv.NEXT_PUBLIC_SENTRY_RELEASE,
      NEXT_PUBLIC_SENTRY_ENVIRONMENT: sentryPublicRuntimeEnv.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    },
    poweredByHeader: false,
    reactStrictMode: true,
    experimental: {
      serverComponentsExternalPackages: ['@electric-sql/pglite'],
    },
  }),
);

export default shouldEnableSentryPlugin
  ? withSentryConfig(
      nextConfig,
      {
        // For all available options, see:
        // https://github.com/getsentry/sentry-webpack-plugin#options
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        release: sentryRelease
          ? {
              name: sentryRelease,
            }
          : undefined,
        deploy: sentryEnvironment
          ? {
              env: sentryEnvironment,
            }
          : undefined,

        // Only print logs for uploading source maps in CI
        silent: !process.env.CI,

        // For all available options, see:
        // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

        // Upload a larger set of source maps for prettier stack traces (increases build time)
        widenClientFileUpload: true,

        // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
        // This can increase your server load as well as your hosting bill.
        // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
        // side errors will fail.
        tunnelRoute: '/monitoring',

        // Hides source maps from generated client bundles
        hideSourceMaps: true,

        // Automatically tree-shake Sentry logger statements to reduce bundle size
        disableLogger: true,

        // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
        // See the following for more information:
        // https://docs.sentry.io/product/crons/
        // https://vercel.com/docs/cron-jobs
        automaticVercelMonitors: true,

        // Disable Sentry telemetry
        telemetry: false,
      },
    )
  : nextConfig;
