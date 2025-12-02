# Button Refactor Summary

## Overview
All buttons across the customer-facing app have been unified into a single, minimal, premium button system using the design-system.md as the single source of truth.

## New Unified Button Component

**Location:** `/src/components/Button.tsx`

### Features
- **Three Variants:**
  - `primary` - Gold background (#f4b864) with dark text
  - `secondary` - Neutral background with light border
  - `ghost` - Text-only with minimal border

- **Two Sizes:**
  - `default` - px-5 py-3.5, text-base (standard buttons)
  - `sm` - px-4 py-2.5, text-sm (compact buttons)

- **Consistent Styling:**
  - Pill-shaped rounded corners (rounded-full)
  - Uniform padding and height
  - Consistent font sizing and weight
  - Subtle shadow (shadow-sm)
  - Smooth hover animations (scale + shadow)
  - Gentle press animations (scale-down)
  - Same disabled state styling

- **Props:**
  - `variant?: 'primary' | 'secondary' | 'ghost'` (default: 'primary')
  - `size?: 'default' | 'sm'` (default: 'default')
  - `fullWidth?: boolean` (default: true)
  - All standard button HTML attributes

### Animation Details
- **Primary Button:**
  - Hover: `scale-[1.02]` + `shadow-md` + `bg-[#f4b864]/90`
  - Press: `scale-[0.97]`
  - Transition: `duration-200 ease-out`

- **Secondary Button:**
  - Hover: `scale-[1.01]` + `bg-neutral-100` + `shadow-sm`
  - Press: `scale-[0.98]`
  - Transition: `duration-200 ease-out`

- **Ghost Button:**
  - Hover: `bg-neutral-50` + `border-neutral-300`
  - Press: `scale-[0.98]`
  - Transition: `duration-200 ease-out`

## Updated Components

### PrimaryButton & SecondaryButton
**Location:** `/src/components/PrimaryButton.tsx` and `/src/components/SecondaryButton.tsx`

These components now wrap the unified Button component for backward compatibility. They maintain the same API but use the unified Button internally.

## Pages Updated

All customer-facing pages have been updated to use the unified button system:

### 1. `/book/service` - Service Selection Page
**File:** `/src/app/[locale]/(unauth)/book/service/page.tsx`
- Updated "Choose technician" button to use `size="sm"`
- Updated auth flow buttons (send code, verify) to use `size="sm"`
- Removed custom className overrides

### 2. `/book/tech` - Technician Selection Page
**File:** `/src/app/[locale]/(unauth)/book/tech/page.tsx`
- No button changes needed (uses card selection, not buttons)

### 3. `/book/time` - Time Selection Page
**File:** `/src/app/[locale]/(unauth)/book/time/page.tsx`
- No button changes needed (uses calendar/time slot selection)

### 4. `/book/confirm` - Confirmation Page
**File:** `/src/app/[locale]/(unauth)/book/confirm/page.tsx`
- Updated "Apply" discount button to use `size="sm"` and `fullWidth={false}`
- Main action buttons already using PrimaryButton/SecondaryButton (now unified)

### 5. `/profile` - Profile Page
**File:** `/src/app/[locale]/(unauth)/profile/page.tsx`
- Updated all buttons to use `size="sm"` instead of custom className overrides
- Updated buttons in:
  - Name edit section (Save/Cancel)
  - Appointment section (View/Change Appointment)
  - Rewards section (View Rewards)
  - Invite section (Share Referral Link)
  - Rate Us section (Rate Us on Google)
  - Beauty Profile edit section (Save/Cancel)
  - Payment cards section (Save Card, Cancel, Done)

### 6. `/rewards` - Rewards Page
**File:** `/src/app/[locale]/(unauth)/rewards/page.tsx`
- Updated "Apply Reward" button to use `size="sm"`
- Updated "Upload Photo" button to use `size="sm"`
- Updated "Leave Google Review" button to use `size="sm"`

### 7. `/appointments/history` - Appointment History Page
**File:** `/src/app/[locale]/(unauth)/appointments/history/page.tsx`
- No button changes needed (display-only page)

### 8. `/invite` - Invite Page
**File:** `/src/app/[locale]/(unauth)/invite/page.tsx`
- Updated "Send Referral" button to use `size="sm"`
- Updated "Copy Referral Link" button to use `size="sm"`
- Updated "Leave a Google Review" button to use `size="sm"`

### 9. `/gallery` - Gallery Page
**File:** `/src/app/[locale]/(unauth)/gallery/page.tsx`
- No button changes needed (display-only page with text links)

## Key Changes Made

1. **Removed all custom className overrides** that were overriding default button styles:
   - Removed `!px-*`, `!py-*`, `!text-*` overrides
   - Replaced with proper `size` prop usage

2. **Standardized button sizing:**
   - Full-width buttons use default size
   - Compact/inline buttons use `size="sm"`
   - Buttons that shouldn't be full-width use `fullWidth={false}`

3. **Maintained backward compatibility:**
   - PrimaryButton and SecondaryButton still work as before
   - They now use the unified Button component internally

## Design System Compliance

All buttons now follow the design-system.md specifications:
- ✅ Consistent padding (px-5 py-3.5 default, px-4 py-2.5 sm)
- ✅ Uniform height
- ✅ Pill-shaped rounded corners (rounded-full)
- ✅ Consistent font sizing (text-base default, text-sm sm)
- ✅ Consistent font weight (bold for primary, semibold for secondary)
- ✅ Subtle shadow (shadow-sm)
- ✅ Smooth hover animations (scale + shadow)
- ✅ Gentle press animations (scale-down)
- ✅ Same disabled state styling
- ✅ Gold background for primary (#f4b864)
- ✅ Neutral background for secondary
- ✅ High contrast text (dark on gold, medium on neutral)

## Next Steps

To verify the changes:
1. Run the development server: `npm run dev`
2. Navigate through all customer-facing pages
3. Check button consistency across:
   - `/book/service`
   - `/book/tech`
   - `/book/time`
   - `/book/confirm`
   - `/profile`
   - `/rewards`
   - `/appointments/history`
   - `/invite`
   - `/gallery`
4. Test on mobile view (responsive design)
5. Verify hover and press animations work smoothly
6. Check disabled states

## Notes

- Icon-only buttons (back buttons, navigation icons) were left as-is since they serve a different purpose
- Text links (like "View all photos") were left as-is since they're not primary action buttons
- All primary action buttons now use the unified Button component
- All secondary action buttons now use the unified Button component

