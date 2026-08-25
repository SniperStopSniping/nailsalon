import type { BookingMenuLayout } from './types';

export const BOOKING_LAYOUT_META = {
  visual_grid: {
    label: 'Visual Grid',
    shortLabel: 'Visual',
    description: 'Photo-first browsing',
    recommendation: 'Recommended for most nail artists',
    photoGuidance: 'Photos recommended',
  },
  clean_list: {
    label: 'Clean List',
    shortLabel: 'List',
    description: 'Simple and fast',
    recommendation: 'Great for straightforward menus',
    photoGuidance: 'Photos optional',
  },
  editorial_cards: {
    label: 'Editorial Cards',
    shortLabel: 'Editorial',
    description: 'Large photos and storytelling',
    recommendation: 'Best when your work sells the service',
    photoGuidance: 'Photos strongly recommended',
  },
  category_menu: {
    label: 'Category Menu',
    shortLabel: 'Categories',
    description: 'Easy to navigate',
    recommendation: 'Best for large service menus',
    photoGuidance: 'Photos optional',
  },
  editorial_price_list: {
    label: 'Editorial Price List',
    shortLabel: 'Price List',
    description: 'Minimal and polished',
    recommendation: 'Great for premium menus',
    photoGuidance: 'Photos optional',
  },
} as const satisfies Record<BookingMenuLayout, {
  description: string;
  label: string;
  photoGuidance: string;
  recommendation: string;
  shortLabel: string;
}>;
