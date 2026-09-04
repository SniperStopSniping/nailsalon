import 'server-only';

import { ZodError } from 'zod';

import { OnboardingIntegrationDisabledError } from './config.server';
import { OnboardingPersistenceError } from './persistence.server';

export function onboardingApiError(error: unknown): Response {
  if (error instanceof OnboardingIntegrationDisabledError) {
    return Response.json({
      error: { code: error.code, message: 'This onboarding route is not available.' },
    }, { status: 404 });
  }
  if (error instanceof ZodError) {
    return Response.json({
      error: { code: 'INVALID_REQUEST', message: 'Check the site details and try again.' },
    }, { status: 400 });
  }
  if (error instanceof OnboardingPersistenceError) {
    return Response.json({
      error: { code: error.code, message: error.message },
    }, { status: error.status });
  }
  // An uncoded failure becomes an opaque 500 for the owner; without this
  // log line it is invisible to operators as well.
  console.error('[onboarding-v1] unexpected save failure', error);
  return Response.json({
    error: {
      code: 'SAVE_FAILED',
      message: 'We couldn’t finish saving your site. Your work is still safe on this device.',
    },
  }, { status: 500 });
}
