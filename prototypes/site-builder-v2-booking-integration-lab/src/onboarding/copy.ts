import type {
  OnboardingScreenId,
  OnboardingStage,
} from './model/types';

export type OnboardingScreenStatus = 'essential' | 'optional' | 'recommended' | null;

export type OnboardingScreenMetadata = {
  stage: OnboardingStage;
  heading: string;
  supportingCopy: string;
  status: OnboardingScreenStatus;
  primaryAction: string;
  secondaryAction?: string;
};

export type OnboardingStageMetadata = {
  label: string;
  order: number;
};

export const STAGE_METADATA: Record<OnboardingStage, OnboardingStageMetadata> = {
  basics: { label: 'Basics', order: 0 },
  booking: { label: 'Booking', order: 1 },
  design: { label: 'Design', order: 2 },
  review: { label: 'Review', order: 3 },
};

export const CORE_SCREEN_ORDER: readonly OnboardingScreenId[] = [
  'welcome',
  'business',
  'photo_social',
  'location_contact',
  'booking_preferences',
  'starter',
  'starting_preview',
  'about',
  'about_design',
  'policies',
  'site_style',
  'extras',
  'final_preview',
];

export const SCREEN_METADATA: Record<OnboardingScreenId, OnboardingScreenMetadata> = {
  about: {
    heading: 'Would you like an About section?',
    primaryAction: 'Choose an About design',
    stage: 'design',
    status: 'optional',
    supportingCopy: 'Share a little about yourself so clients feel comfortable booking with you.',
  },
  about_design: {
    heading: 'Choose your About design',
    primaryAction: 'Use this design',
    secondaryAction: 'Back to edit About',
    stage: 'design',
    status: 'optional',
    supportingCopy: 'Your information stays the same when you switch designs.',
  },
  booking_preferences: {
    heading: 'How do clients book with you?',
    primaryAction: 'Save booking setup',
    stage: 'booking',
    status: 'essential',
    supportingCopy: 'We’ll use these settings on your website and when showing available appointments.',
  },
  business: {
    heading: 'Tell us about your nail business',
    primaryAction: 'Continue',
    stage: 'basics',
    status: 'essential',
    supportingCopy: 'We’ll use this information throughout your site.',
  },
  extras: {
    heading: 'Add something extra',
    primaryAction: 'Continue to review',
    stage: 'design',
    status: 'optional',
    supportingCopy: 'Make your first site more personal, or continue without adding anything.',
  },
  final_preview: {
    heading: 'Review your site',
    primaryAction: 'Finish setup',
    secondaryAction: 'Change setup',
    stage: 'review',
    status: null,
    supportingCopy: 'Your website is saved. You can edit it anytime from your dashboard.',
  },
  location_contact: {
    heading: 'Where can clients find you?',
    primaryAction: 'Save and continue',
    stage: 'basics',
    status: 'essential',
    supportingCopy: 'Add only what you’re comfortable sharing publicly.',
  },
  photo_social: {
    heading: 'Add your photo and Instagram',
    primaryAction: 'Continue',
    secondaryAction: 'Skip for now',
    stage: 'basics',
    status: 'optional',
    supportingCopy: 'Help clients recognize you and find your work.',
  },
  policies: {
    heading: 'Set clear expectations',
    primaryAction: 'Save policies',
    secondaryAction: 'Skip for now',
    stage: 'design',
    status: 'recommended',
    supportingCopy: 'Answer a few questions and Luster will organize the wording for you.',
  },
  site_style: {
    heading: 'Choose your website style',
    primaryAction: 'Use this style',
    stage: 'design',
    status: 'essential',
    supportingCopy: 'Pick the colours, fonts and overall feel of your site. You can change this anytime.',
  },
  starter: {
    heading: 'Choose your starting point',
    primaryAction: 'Use this starting point',
    stage: 'booking',
    status: 'essential',
    supportingCopy: 'Start simple or with a full website. You can add or change pages and sections anytime.',
  },
  starting_preview: {
    heading: 'Your starting site is ready',
    primaryAction: 'Continue setting up my site',
    secondaryAction: 'Preview my site',
    stage: 'booking',
    status: null,
    supportingCopy: 'We created this first version from your information. Take a look, then we’ll finish the details that make it feel like your business.',
  },
  welcome: {
    heading: 'Let’s build your website',
    primaryAction: 'Build my website',
    secondaryAction: 'I want to use a Canva design',
    stage: 'basics',
    status: null,
    supportingCopy: 'Tell us about your nail business once. Luster turns your details into a polished website where clients can learn about you and book online.',
  },
};

export const WELCOME_BENEFITS = [
  'Add your details once',
  'Start with a ready-made service menu',
  'Switch designs without starting over',
] as const;

export const ONBOARDING_STAGE_ORDER = (
  Object.entries(STAGE_METADATA) as Array<[OnboardingStage, OnboardingStageMetadata]>
)
  .sort((left, right) => left[1].order - right[1].order)
  .map(([stage]) => stage);
