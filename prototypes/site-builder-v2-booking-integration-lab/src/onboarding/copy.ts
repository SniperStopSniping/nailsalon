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
    supportingCopy: 'Share the details that help clients feel comfortable booking with you.',
  },
  about_design: {
    heading: 'Choose your About design',
    primaryAction: 'Use this design',
    secondaryAction: 'Back to edit About',
    stage: 'design',
    status: 'optional',
    supportingCopy: 'Switch designs without re-entering your information.',
  },
  booking_preferences: {
    heading: 'How can clients book with you?',
    primaryAction: 'Save booking information',
    stage: 'booking',
    status: 'essential',
    supportingCopy: 'We’ll show this information clearly across your site.',
  },
  business: {
    heading: 'Tell us about your business',
    primaryAction: 'Continue',
    stage: 'basics',
    status: 'essential',
    supportingCopy: 'We’ll use this information throughout your site.',
  },
  extras: {
    heading: 'Add something extra',
    primaryAction: 'Continue to review',
    secondaryAction: 'Skip extras',
    stage: 'design',
    status: 'optional',
    supportingCopy: 'Make your first site more personal, or skip this for now.',
  },
  final_preview: {
    heading: 'Review your site',
    primaryAction: 'Open my Builder',
    secondaryAction: 'Edit setup',
    stage: 'review',
    status: null,
    supportingCopy: 'Check the customer experience before opening the full Builder.',
  },
  location_contact: {
    heading: 'Where can clients find you?',
    primaryAction: 'Save and continue',
    stage: 'basics',
    status: 'essential',
    supportingCopy: 'Add only what you’re comfortable sharing publicly.',
  },
  photo_social: {
    heading: 'Add your photo and social presence',
    primaryAction: 'Continue',
    secondaryAction: 'Skip photo for now',
    stage: 'basics',
    status: 'optional',
    supportingCopy: 'Help clients recognize you and connect with your business.',
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
    heading: 'Choose your look',
    primaryAction: 'Use this style',
    secondaryAction: 'Keep current style',
    stage: 'design',
    status: 'essential',
    supportingCopy: 'See your actual information in every style.',
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
    secondaryAction: 'I already have a Canva design',
    stage: 'basics',
    status: null,
    supportingCopy: 'Add your business information once. Luster will use it across your website, booking page, policies, contact details, and future sections.',
  },
};

export const WELCOME_BENEFITS = [
  'Enter information once',
  'Change designs without retyping',
  'Update connected sections automatically',
] as const;

export const ONBOARDING_STAGE_ORDER = (
  Object.entries(STAGE_METADATA) as Array<[OnboardingStage, OnboardingStageMetadata]>
)
  .sort((left, right) => left[1].order - right[1].order)
  .map(([stage]) => stage);
