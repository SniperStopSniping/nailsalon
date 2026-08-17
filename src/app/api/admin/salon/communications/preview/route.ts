/**
 * Admin SMS template preview — Gate A foundation.
 *
 * POST /api/admin/salon/communications/preview?salonSlug=...
 * Body: { templateKey }
 *
 * Renders a CONTROLLED template with the salon's real display name and
 * synthetic appointment variables, returning the body, segmentation and the
 * "142/160 · 1 SMS credit" counter string. Strictly read-only: no provider
 * import, no send, no credit reservation, no database write, no secrets in
 * the response. Governing contract: docs/luster-billing-communications-rev-2-2.md
 * §11.10.
 */
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import {
  COMMUNICATION_TEMPLATES,
  MAX_SEGMENTS_BY_AUDIENCE,
  sanitizeSalonNameForSms,
  WORST_CASE_MANAGE_URL_SHORT_ORIGIN,
} from '@/libs/communicationTemplates';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import { calculateSmsSegments, formatSegmentPreview } from '@/libs/smsSegments';

const previewRequestSchema = z.object({
  templateKey: z.string().min(1).max(100),
}).strict();

/** Synthetic, deterministic variables — never client data, never a real link. */
const SYNTHETIC_VARIABLES = {
  startTime: 'Wed Aug 26, 2:30 PM',
  manageUrl: WORST_CASE_MANAGE_URL_SHORT_ORIGIN,
  clientName: 'Jordan Sample',
  serviceName: 'Classic Manicure',
} as const;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rateLimit = checkEndpointRateLimit('communications/preview', ip, 'GENERAL');
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.retryAfterMs);
  }

  const salonSlug = new URL(request.url).searchParams.get('salonSlug');
  if (!salonSlug) {
    return Response.json(
      { error: { code: 'INVALID_INPUT', message: 'salonSlug is required' } },
      { status: 400 },
    );
  }

  const { error, salon } = await requireAdminSalon(salonSlug);
  if (error || !salon) {
    return error ?? Response.json(
      { error: { code: 'SALON_NOT_FOUND', message: 'Salon not found' } },
      { status: 404 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: 'INVALID_INPUT', message: 'Request body must be JSON' } },
      { status: 400 },
    );
  }

  const parsed = previewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'INVALID_INPUT', message: 'templateKey is required' } },
      { status: 400 },
    );
  }

  const template = Object.hasOwn(COMMUNICATION_TEMPLATES, parsed.data.templateKey)
    ? COMMUNICATION_TEMPLATES[parsed.data.templateKey]
    : undefined;
  if (template === undefined) {
    return Response.json(
      { error: { code: 'UNKNOWN_TEMPLATE', message: 'Unknown template key' } },
      { status: 404 },
    );
  }

  const rendered = template.render({
    ...SYNTHETIC_VARIABLES,
    salonName: salon.name,
  });
  const segmentation = calculateSmsSegments(rendered);

  const warnings: Array<'MULTI_SEGMENT' | 'UCS2_FALLBACK' | 'NAME_TRUNCATED'> = [];
  if (segmentation.segments > MAX_SEGMENTS_BY_AUDIENCE[template.audience]) {
    warnings.push('MULTI_SEGMENT');
  }
  if (segmentation.encoding === 'ucs2') {
    warnings.push('UCS2_FALLBACK');
  }
  if (sanitizeSalonNameForSms(salon.name) !== salon.name.trim()) {
    warnings.push('NAME_TRUNCATED');
  }

  return Response.json(
    {
      data: {
        templateKey: template.key,
        templateVersion: template.version,
        audience: template.audience,
        body: rendered,
        segmentation,
        preview: formatSegmentPreview(segmentation),
        warnings,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
