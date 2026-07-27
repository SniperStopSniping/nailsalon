import { z } from 'zod';

import type {
  BookingExperience as BookingExperienceShape,
  SalonSettings,
} from '@/types/salonPolicy';

export type BookingExperience = BookingExperienceShape;

export const BOOKING_EXPERIENCE_LIMITS = {
  bookingMessage: 160,
  policyTitle: 60,
  policyText: 1_500,
  confirmationMessage: 500,
  socialUrl: 500,
} as const;

export const BOOKING_EXPERIENCE_DEFAULTS: BookingExperience = {
  primaryColor: null,
  bookingMessage: null,
  policy: {
    enabled: false,
    title: null,
    text: null,
  },
  appointmentOnly: false,
  socialLinks: {
    instagram: null,
    facebook: null,
    tiktok: null,
  },
  confirmationMessage: null,
};

const CANONICAL_HEX_COLOR = /^#[0-9A-F]{6}$/u;

type SocialPlatform = keyof BookingExperience['socialLinks'];

const SOCIAL_HOSTS: Record<SocialPlatform, ReadonlySet<string>> = {
  instagram: new Set(['instagram.com', 'www.instagram.com']),
  facebook: new Set(['facebook.com', 'www.facebook.com']),
  tiktok: new Set(['tiktok.com', 'www.tiktok.com']),
};

function characterCount(value: string): number {
  return Array.from(value).length;
}

function containsDisallowedControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 9
      || (codePoint >= 11 && codePoint <= 31)
      || (codePoint >= 127 && codePoint <= 159)
    );
  });
}

function containsUrlControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });
}

function optionalPlainTextSchema(maxCharacters: number, label: string) {
  return z.union([z.string(), z.null()]).transform((value, context) => {
    if (value === null) {
      return null;
    }

    // Only CRLF is normalized. A lone carriage return remains a disallowed
    // control character rather than being silently accepted.
    const normalizedLineEndings = value.replace(/\r\n/gu, '\n');
    if (containsDisallowedControlCharacter(normalizedLineEndings)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} contains a disallowed control character`,
      });
      return z.NEVER;
    }

    const normalized = normalizedLineEndings.trim();
    if (normalized === '') {
      return null;
    }

    if (characterCount(normalized) > maxCharacters) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} must be ${maxCharacters} characters or fewer`,
      });
      return z.NEVER;
    }

    return normalized;
  });
}

const primaryColorSchema = z.union([z.string(), z.null()]).transform(
  (value, context) => {
    if (value === null) {
      return null;
    }

    const normalized = value.trim().toUpperCase();
    if (normalized === '') {
      return null;
    }

    if (!CANONICAL_HEX_COLOR.test(normalized)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Primary colour must use the #RRGGBB format',
      });
      return z.NEVER;
    }

    return normalized;
  },
);

function socialUrlSchema(platform: SocialPlatform) {
  return z.union([z.string(), z.null()]).transform((value, context) => {
    if (value === null) {
      return null;
    }

    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }

    if (containsUrlControlCharacter(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${platform} URL contains a disallowed control character`,
      });
      return z.NEVER;
    }

    if (characterCount(trimmed) > BOOKING_EXPERIENCE_LIMITS.socialUrl) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${platform} URL must be ${BOOKING_EXPERIENCE_LIMITS.socialUrl} characters or fewer`,
      });
      return z.NEVER;
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${platform} URL must be an absolute HTTPS URL`,
      });
      return z.NEVER;
    }

    if (parsed.protocol !== 'https:') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${platform} URL must use HTTPS`,
      });
      return z.NEVER;
    }

    if (parsed.username !== '' || parsed.password !== '' || parsed.port !== '') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${platform} URL must not contain credentials or a custom port`,
      });
      return z.NEVER;
    }

    if (!SOCIAL_HOSTS[platform].has(parsed.hostname)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${platform} URL must use an approved ${platform} hostname`,
      });
      return z.NEVER;
    }

    let decodedUrlParts: string;
    try {
      decodedUrlParts = decodeURIComponent(
        `${parsed.pathname}${parsed.search}${parsed.hash}`,
      );
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${platform} URL contains malformed encoding`,
      });
      return z.NEVER;
    }

    if (containsUrlControlCharacter(decodedUrlParts)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${platform} URL contains a disallowed encoded character`,
      });
      return z.NEVER;
    }

    const decodedPathname = decodeURIComponent(parsed.pathname);
    const hasProfilePath = decodedPathname
      .split(/[\\/]/u)
      .some(segment => segment.trim().length > 0);
    if (!hasProfilePath) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${platform} URL must include a profile or page path`,
      });
      return z.NEVER;
    }

    const canonicalUrl = parsed.toString();
    if (characterCount(canonicalUrl) > BOOKING_EXPERIENCE_LIMITS.socialUrl) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${platform} URL must be ${BOOKING_EXPERIENCE_LIMITS.socialUrl} characters or fewer after normalization`,
      });
      return z.NEVER;
    }

    return canonicalUrl;
  });
}

const policySchema = z.object({
  enabled: z.boolean(),
  title: optionalPlainTextSchema(
    BOOKING_EXPERIENCE_LIMITS.policyTitle,
    'Policy title',
  ),
  text: optionalPlainTextSchema(
    BOOKING_EXPERIENCE_LIMITS.policyText,
    'Policy text',
  ),
}).strict().superRefine((policy, context) => {
  if (policy.enabled && policy.text === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Policy text is required when the policy is enabled',
      path: ['text'],
    });
  }
});

export const bookingExperienceUpdateSchema = z.object({
  primaryColor: primaryColorSchema,
  bookingMessage: optionalPlainTextSchema(
    BOOKING_EXPERIENCE_LIMITS.bookingMessage,
    'Booking message',
  ),
  policy: policySchema,
  appointmentOnly: z.boolean(),
  socialLinks: z.object({
    instagram: socialUrlSchema('instagram'),
    facebook: socialUrlSchema('facebook'),
    tiktok: socialUrlSchema('tiktok'),
  }).strict(),
  confirmationMessage: optionalPlainTextSchema(
    BOOKING_EXPERIENCE_LIMITS.confirmationMessage,
    'Confirmation message',
  ),
}).strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveNullableField(
  schema: z.ZodType<string | null>,
  value: unknown,
): string | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}

/**
 * Resolves persisted JSON defensively and never throws. Invalid fields fall
 * back independently, so one malformed legacy value cannot hide otherwise
 * valid booking customization.
 */
export function resolveBookingExperience(
  settings: SalonSettings | null | undefined,
): BookingExperience {
  if (!isRecord(settings) || !isRecord(settings.bookingExperience)) {
    return {
      ...BOOKING_EXPERIENCE_DEFAULTS,
      policy: { ...BOOKING_EXPERIENCE_DEFAULTS.policy },
      socialLinks: { ...BOOKING_EXPERIENCE_DEFAULTS.socialLinks },
    };
  }

  const stored = settings.bookingExperience as unknown as Record<string, unknown>;
  const storedPolicy = isRecord(stored.policy) ? stored.policy : {};
  const storedSocialLinks = isRecord(stored.socialLinks)
    ? stored.socialLinks
    : {};

  const policyText = resolveNullableField(
    optionalPlainTextSchema(
      BOOKING_EXPERIENCE_LIMITS.policyText,
      'Policy text',
    ),
    storedPolicy.text,
  );
  const requestedPolicyEnabled = storedPolicy.enabled === true;

  return {
    primaryColor: resolveNullableField(primaryColorSchema, stored.primaryColor),
    bookingMessage: resolveNullableField(
      optionalPlainTextSchema(
        BOOKING_EXPERIENCE_LIMITS.bookingMessage,
        'Booking message',
      ),
      stored.bookingMessage,
    ),
    policy: {
      // An invalid/empty published policy fails closed while its other valid
      // draft fields remain available to the editor.
      enabled: requestedPolicyEnabled && policyText !== null,
      title: resolveNullableField(
        optionalPlainTextSchema(
          BOOKING_EXPERIENCE_LIMITS.policyTitle,
          'Policy title',
        ),
        storedPolicy.title,
      ),
      text: policyText,
    },
    appointmentOnly: stored.appointmentOnly === true,
    socialLinks: {
      instagram: resolveNullableField(
        socialUrlSchema('instagram'),
        storedSocialLinks.instagram,
      ),
      facebook: resolveNullableField(
        socialUrlSchema('facebook'),
        storedSocialLinks.facebook,
      ),
      tiktok: resolveNullableField(
        socialUrlSchema('tiktok'),
        storedSocialLinks.tiktok,
      ),
    },
    confirmationMessage: resolveNullableField(
      optionalPlainTextSchema(
        BOOKING_EXPERIENCE_LIMITS.confirmationMessage,
        'Confirmation message',
      ),
      stored.confirmationMessage,
    ),
  };
}

function hexToRgb(color: string): [number, number, number] | null {
  const normalized = color.trim().toUpperCase();
  if (!CANONICAL_HEX_COLOR.test(normalized)) {
    return null;
  }

  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

function mixWithWhite(color: string, colorWeight: number): string | null {
  const rgb = hexToRgb(color);
  if (!rgb) {
    return null;
  }

  const mixed = rgb.map(channel =>
    Math.round(channel * colorWeight + 255 * (1 - colorWeight)));

  return `#${mixed
    .map(channel => channel.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

function linearizeSrgb(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function getRelativeLuminance(color: string): number {
  const rgb = hexToRgb(color);
  if (!rgb) {
    return 0;
  }

  return (
    0.2126 * linearizeSrgb(rgb[0])
    + 0.7152 * linearizeSrgb(rgb[1])
    + 0.0722 * linearizeSrgb(rgb[2])
  );
}

export function getColorContrastRatio(
  firstColor: string,
  secondColor: string,
): number {
  const firstLuminance = getRelativeLuminance(firstColor);
  const secondLuminance = getRelativeLuminance(secondColor);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function getAccessibleBookingForeground(
  primaryColor: string,
): '#000000' | '#FFFFFF' {
  const blackContrast = getColorContrastRatio(primaryColor, '#000000');
  const whiteContrast = getColorContrastRatio(primaryColor, '#FFFFFF');
  return blackContrast >= whiteContrast ? '#000000' : '#FFFFFF';
}

export type BookingExperienceCssVariables = {
  '--booking-brand-primary'?: string;
  '--booking-brand-foreground'?: string;
  '--booking-brand-selection-background'?: string;
  '--booking-brand-state-border'?: string;
  '--theme-selected-ring'?: string;
  '--n5-button-primary-bg'?: string;
  '--n5-button-primary-text'?: string;
};

/**
 * Returns trusted CSS variable values only for a valid configured colour.
 * Text accents are intentionally not overridden: a light brand colour may be
 * safe as a button background with black text but unsafe as body text.
 */
export function getBookingExperienceCssVariables(
  primaryColor: string | null,
): BookingExperienceCssVariables {
  const parsedColor = primaryColorSchema.safeParse(primaryColor);
  if (!parsedColor.success || parsedColor.data === null) {
    return {};
  }

  const color = parsedColor.data;
  const foreground = getAccessibleBookingForeground(color);
  const selectionBackground = mixWithWhite(color, 0.15) ?? '#FFFFFF';
  const stateBorder = (
    getColorContrastRatio(color, '#FFFFFF') >= 3
    && getColorContrastRatio(color, selectionBackground) >= 3
  )
    ? color
    : '#000000';

  return {
    '--booking-brand-primary': color,
    '--booking-brand-foreground': foreground,
    '--booking-brand-selection-background': `color-mix(in srgb, ${color} 15%, white)`,
    '--booking-brand-state-border': stateBorder,
    '--theme-selected-ring': stateBorder,
    '--n5-button-primary-bg': color,
    '--n5-button-primary-text': foreground,
  };
}
