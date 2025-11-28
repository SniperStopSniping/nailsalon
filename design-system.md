# Design System Plan
## Nail Salon No.5 — Luxury Mobile-First Spa Aesthetic

---

## Table of Contents

1. [Card Layout Standards](#1-card-layout-standards)
2. [Typography Scale](#2-typography-scale)
3. [Spacing & Layout System](#3-spacing--layout-system)
4. [Color System](#4-color-system)
5. [Interaction & Animation Rules](#5-interaction--animation-rules)
6. [Component Library Rules](#6-component-library-rules)
7. [Page Layout Patterns](#7-page-layout-patterns)
8. [Key Decisions Summary](#8-key-decisions-summary)

---

## 1. Card Layout Standards

### Primary Card Specifications

**Max Width:**
- **Desktop/Tablet:** `max-w-[430px]` (430px maximum)
- **Mobile:** `w-full` (100% width)
- **Container:** Always use `mx-auto` for centering

**Corner Radius:**
- **Standard:** `rounded-2xl` (16px border-radius)
- **Small cards/buttons:** `rounded-xl` (12px) or `rounded-full` for pill shapes

**Shadows:**
- **Primary card shadow:** `shadow-[0_4px_20px_rgba(0,0,0,0.08)]`
- **Hover state (desktop only):** `shadow-[0_4px_20px_rgba(0,0,0,0.1)]`
- **Small cards/buttons:** `shadow-sm`

**Borders:**
- **Primary cards:** `border border-[#e6d6c2]` (warm beige border)
- **Secondary cards:** `border border-neutral-100` or `border-neutral-200`
- **Input fields:** `border border-neutral-200` with `focus:border-[#d6a249]`

**Padding:**
- **Card body:** `px-5 py-6` (20px horizontal, 24px vertical)
- **Compact cards:** `px-4 py-4` (16px all around)
- **Card sections:** Use `px-5` for horizontal padding consistency

**Card Structure:**
```
┌─────────────────────────────┐
│ Gold Accent Bar (optional)  │ ← h-1 bg-gradient-to-r from-[#d6a249] to-[#f4b864]
├─────────────────────────────┤
│ Header Section (optional)    │ ← px-5 py-4 or py-6
├─────────────────────────────┤
│ Body Content                │ ← px-5 py-6 (main content area)
│                             │
├─────────────────────────────┤
│ Footer Section (optional)    │ ← px-5 py-4 (buttons, actions)
└─────────────────────────────┘
```

**Card Background:**
- **Primary cards:** `bg-white`
- **Selected state:** `bg-[#f5e6d3]` (warm beige tint)
- **Hover state (desktop):** Subtle lift with `translateY(-1px)`

**Card Sections:**
- **Dividers:** Use `border-b border-neutral-100` between sections
- **Section spacing:** `gap-5` (20px) between sections within cards
- **Row spacing within sections:** `space-y-2` (8px) for rows
- **Vertical spacing between sections:** `py-4` or `py-5`

---

## 2. Typography Scale

### Page Titles
- **Size:** `text-3xl` (30px) or `text-xl` (20px)
- **Weight:** `font-semibold` (600)
- **Color:** `text-[#7b4ea3]` (brand purple)
- **Usage:** Main page headlines, confirmation titles
- **Example:** "Appointment Confirmed", "Choose Technician"

### Section Titles
- **Size:** `text-base` (16px)
- **Weight:** `font-semibold` (600)
- **Color:** `text-neutral-900`
- **Usage:** Section headers within cards, form labels
- **Example:** "Choose Date", "Select Time"

### Label Text
- **Size:** `text-sm` (14px)
- **Weight:** `font-medium` (500)
- **Color:** `text-neutral-500`
- **Usage:** Form labels, summary row labels, helper text
- **Example:** "Service", "Nail Tech", "Date & Time"

### Value Text
- **Size:** `text-base` (16px)
- **Weight:** `font-semibold` (600)
- **Color:** `text-neutral-900`
- **Usage:** Summary row values, important data display
- **Example:** Service names, prices, technician names

### New Total Row
- **Size:** `text-[18px]` (18px)
- **Weight:** `font-bold` (700)
- **Color:** `text-neutral-900`
- **Usage:** Final total row in summary sections (e.g., "New Total" in confirm page)
- **Example:** "$95.00" in confirmation summary

### Button Font Sizes
- **Primary buttons:** `text-base` (16px) with `font-bold` (700)
- **Secondary buttons:** `text-base` (16px) with `font-semibold` (600)
- **Small buttons:** `text-sm` (14px) with `font-semibold` (600)
- **Color:** `text-neutral-900` on gold buttons, `text-neutral-700` on secondary

### Subtext / Notes
- **Size:** `text-[13px]` (13px) or `text-xs` (12px)
- **Weight:** `font-medium` (500) or default (400)
- **Color:** `text-neutral-600` or `text-neutral-500`
- **Usage:** Helper text, disclaimers, microcopy
- **Example:** "You earned 65 points from this visit", "No payment required to reserve"

### Small Text / Captions
- **Size:** `text-[10px]` (10px) or `text-[11px]` (11px)
- **Weight:** `font-medium` (500) or default
- **Color:** `text-neutral-500` or `text-neutral-400`
- **Usage:** Fine print, timestamps, metadata

### Typography Hierarchy Example
```
Page Title (text-3xl, #7b4ea3, semibold)
  ↓
Section Title (text-base, neutral-900, semibold)
  ↓
Label (text-sm/14px, neutral-500, medium) | Value (text-base/16px, neutral-900, semibold)
  ↓
New Total (text-[18px], neutral-900, bold)
  ↓
Subtext (text-[13px], neutral-600, medium)
  ↓
Caption (text-xs, neutral-500, default)
```

---

## 3. Spacing & Layout System

### Page-Level Spacing

**Container:**
- **Max width:** `max-w-[430px]`
- **Horizontal padding:** `px-4` (16px)
- **Top padding:** `pt-6` (24px)
- **Bottom padding:** `pb-10` (40px)
- **Background:** `bg-[#f6ebdd]` (warm beige) or `bg-[#f5e8d8]` (slightly warmer variant)

**Page Structure:**
```tsx
<div className="min-h-screen bg-[#f6ebdd] flex justify-center pt-6 pb-10">
  <div className="mx-auto max-w-[430px] w-full px-4 flex flex-col gap-4">
    {/* Page content */}
  </div>
</div>
```

### Vertical Spacing Between Sections

**Page-Level Spacing:**
- **Large sections:** `gap-8` (32px) — between major page sections
- **Medium sections:** `gap-4` (16px) — between cards or content blocks
- **Small sections:** `gap-3` (12px) — between related items

**Card-Level Spacing:**
- **Between sections inside cards:** `gap-5` (20px)
- **Within card sections:** `space-y-2` (8px) for rows

### Row Spacing Inside Cards

- **Summary rows:** `space-y-2` (8px between rows)
- **Form fields:** `space-y-3` (12px between fields)
- **List items:** `space-y-2` (8px)

### Standard Padding Values

- **Card padding:** `px-5 py-6` (20px × 24px)
- **Compact card padding:** `px-4 py-4` (16px × 16px)
- **Button padding:** `px-5 py-3.5` (20px × 14px) for primary, `px-4 py-2.5` for secondary
- **Input padding:** `px-4 py-2.5` (16px × 10px) or `px-3 py-2` (12px × 8px)

### Space Between Buttons

- **Button groups:** `gap-3` (12px) — vertical stacking
- **Inline buttons:** `gap-2` (8px) — horizontal layout

### Container Layout Rules

**Every page should follow this structure:**
```tsx
<div className="min-h-screen bg-[#f6ebdd] flex justify-center pt-6 pb-10">
  <div className="mx-auto max-w-[430px] w-full px-4 flex flex-col gap-4">
    {/* Header/Navigation */}
    {/* Main Content Cards */}
    {/* Footer/Actions */}
  </div>
</div>
```

**Grid Layouts:**
- **2-column grid:** `grid grid-cols-2 gap-2.5` (for service cards, technician cards)
- **3-column grid:** `grid grid-cols-3 gap-2.5` (for time slots)
- **7-column grid:** `grid grid-cols-7 gap-1` (for calendar)

---

## 4. Color System

### Brand Colors

**Purple (Titles & Accents):**
- **Primary purple:** `#7b4ea3`
- **Usage:** Page titles, section headers, primary text accents
- **Tailwind class:** `text-[#7b4ea3]`

**Gold (Buttons & Accents):**
- **Primary gold:** `#f4b864` — Main button background, lighter accents
- **Dark gold:** `#d6a249` — Selected states, rings, darker accents
- **Gradient:** `from-[#d6a249] to-[#f4b864]` — Accent bars, selected calendar days
- **Usage:** Primary buttons, selected states, accent bars, checkmarks
- **Tailwind classes:** 
  - `bg-[#f4b864]` (primary buttons)
  - `bg-[#d6a249]` (selected badges, checkmarks)
  - `ring-[#d6a249]` (selection rings)

### Neutral Text Palette

**Text Colors (from darkest to lightest):**
- **Neutral 900:** `text-neutral-900` — Primary text, values, important content
- **Neutral 700:** `text-neutral-700` — Secondary text, labels (when not using 500)
- **Neutral 600:** `text-neutral-600` — Tertiary text, subtext, descriptions
- **Neutral 500:** `text-neutral-500` — Labels, helper text, less important info
- **Neutral 400:** `text-neutral-400` — Disabled text, placeholders, dividers
- **Neutral 300:** `text-neutral-300` — Disabled states, past dates

### Background Colors

**Page Backgrounds:**
- **Primary background:** `bg-[#f6ebdd]` — Main page background (warm beige)
- **Alternative background:** `bg-[#f5e8d8]` — Slightly warmer variant
- **Card background:** `bg-white` — All primary cards
- **Selected card background:** `bg-[#f5e6d3]` — Selected service/technician cards
- **Input background:** `bg-neutral-50` or `bg-neutral-100` — Form inputs
- **Hover background:** `bg-neutral-100` — Button hover states

### Border Colors

- **Card borders:** `border-[#e6d6c2]` (warm beige) or `border-neutral-100`
- **Input borders:** `border-neutral-200` with `focus:border-[#d6a249]`
- **Dividers:** `border-neutral-100`

### Status Colors

- **Success/Checkmark:** Gold (`#d6a249`) with white checkmark
- **Error:** `text-red-500` — Error messages
- **Highlight:** `bg-[#fef9e7]` — Temporary highlight background (e.g., discount applied)

### Color Usage Guidelines

1. **Purple (#7b4ea3):** Use exclusively for page titles and primary headings
2. **Gold (#f4b864 / #d6a249):** Use for all interactive elements (buttons, selections, accents)
3. **Neutral scale:** Use for all body text, following the hierarchy (900 → 400)
4. **Backgrounds:** Always use warm beige (`#f6ebdd`) for page backgrounds, white for cards
5. **Never mix:** Don't use purple for buttons or gold for titles — maintain strict separation

---

## 5. Interaction & Animation Rules

### Checkmark Success Animation

**Timing & Sequence:**
1. Checkmark appears first (0ms delay)
2. Title fades in after 220ms delay
3. Card appears after 300ms delay
4. Gold bar animates 50ms after card starts

**Checkmark Animation:**
```tsx
style={{
  opacity: checkmarkVisible ? 1 : 0,
  transform: checkmarkVisible ? 'scale(1)' : 'scale(0.85)',
  transition: 'opacity 200ms ease-out, transform 200ms ease-out',
}}
```

**Visual Specs:**
- **Size:** `w-28 h-28` (112px)
- **Background:** `bg-[#d6a249]` with `shadow-[0_12px_40px_rgba(214,162,73,0.5)]`
- **Glow effect:** Blur-2xl overlay with 50% opacity
- **Icon:** White checkmark, 56px (stroke-width: 3)

### Staggered Page Load Animation

**Sequence:**
1. **Checkmark/Icon:** 0ms delay, 200ms duration
2. **Title:** 220ms delay, 250ms duration
3. **Card:** 300ms delay, 250ms duration
4. **Gold bar:** 350ms delay, 400ms duration

**Animation Properties:**
```tsx
// Title
opacity: titleVisible ? 1 : 0,
transform: titleVisible ? 'translateY(0)' : 'translateY(10px)',
transition: 'opacity 250ms ease-out, transform 250ms ease-out'

// Card
opacity: cardVisible ? 1 : 0,
transform: cardVisible ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
transition: 'opacity 250ms ease-out, transform 250ms ease-out'
```

### Card Fade/Slide Animation

**Entry Animation:**
- **Initial state:** `opacity: 0`, `translateY(10px)`, `scale(0.97)`
- **Final state:** `opacity: 1`, `translateY(0)`, `scale(1)`
- **Duration:** 250ms
- **Easing:** `ease-out`

**Gold Bar Wipe:**
- **Initial state:** `width: 0%`
- **Final state:** `width: 100%`
- **Duration:** 400ms
- **Easing:** `ease-out`
- **Direction:** Left to right

### Button Hover & Press Micro-interactions

**Primary Button (Gold):**
- **Hover:** `scale-[1.02]` + `shadow-md` + `hover:bg-[#f4b864]/90`
- **Active/Press:** `scale-[0.97]`
- **Transition:** `transition-all duration-200 ease-out`

**Secondary Button (Neutral):**
- **Hover:** `scale-[1.01]` + `hover:bg-neutral-100` + `hover:shadow-sm`
- **Active/Press:** `scale-[0.98]`
- **Transition:** `transition-all duration-200 ease-out`

**Small Buttons:**
- **Hover:** `hover:bg-white/50` or `hover:bg-neutral-100`
- **Active:** `active:scale-95`
- **Transition:** `transition-all duration-150`

### Hover Lifts (Desktop Only)

**Card Hover:**
```tsx
onMouseEnter={(e) => {
  if (window.innerWidth >= 768) {
    e.currentTarget.style.transform = 'translateY(-1px) scale(1)';
    e.currentTarget.style.boxShadow = '0_4px_20px_rgba(0, 0, 0, 0.1)';
  }
}}
onMouseLeave={(e) => {
  if (window.innerWidth >= 768) {
    e.currentTarget.style.transform = 'translateY(0) scale(1)';
    e.currentTarget.style.boxShadow = '0_4px_20px_rgba(0, 0, 0, 0.08)';
  }
}}
```

**Rules:**
- Only apply on screens ≥ 768px (desktop/tablet)
- Lift: `translateY(-1px)`
- Shadow increase: From `0.08` to `0.1` opacity
- No scale change on hover (only translateY)

### Selection Animations

**Service/Technician Selection:**
- **Ring:** `ring-2 ring-[#d6a249] ring-offset-1`
- **Background change:** `bg-[#f5e6d3]`
- **Checkmark badge:** Appears with `transition-all duration-150`
- **Badge:** `bg-[#d6a249]` with white checkmark, `shadow-md`

**Calendar Day Selection:**
- **Selected:** `bg-gradient-to-br from-[#d6a249] to-[#f4b864]` + `ring-2 ring-[#d6a249]`
- **Today (unselected):** `bg-[#fff7ec]` + `border border-[#d6a249]/30`
- **Transition:** `transition-all duration-200`

### Highlight Animation (Discount Applied)

**Temporary Highlight:**
```tsx
className={`transition-all duration-500 ${
  highlightRows ? 'bg-[#fef9e7] rounded px-2 py-1.5 -mx-2' : ''
}`}
```

- **Background:** `bg-[#fef9e7]` (light gold tint)
- **Duration:** 500ms transition
- **Auto-remove:** After 2000ms (2 seconds)

---

## 6. Component Library Rules

### MainCard

**Purpose:** Primary container for all card-based content (confirmations, summaries, forms)

**Props:**
```tsx
interface MainCardProps {
  children: React.ReactNode;
  showGoldBar?: boolean; // Optional gold accent bar at top
  className?: string;
}
```

**Structure:**
```tsx
<div className="w-full rounded-2xl bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.08)] overflow-hidden">
  {showGoldBar && (
    <div className="h-1 bg-gradient-to-r from-[#d6a249] to-[#f4b864]" />
  )}
  <div className="px-5 py-6">
    {children}
  </div>
</div>
```

**Usage:** Wrap all primary card content (summary sections, forms, confirmations)

---

### SummaryRow

**Purpose:** Two-column layout for displaying label-value pairs (receipt-style)

**Props:**
```tsx
interface SummaryRowProps {
  label: string;
  value: string | React.ReactNode;
  highlight?: boolean; // For temporary highlights (discount applied)
}
```

**Structure:**
```tsx
<div className={`flex justify-between items-start ${
  highlight ? 'bg-[#fef9e7] rounded px-2 py-1.5 -mx-2' : ''
} transition-all duration-500`}>
  <div className="text-sm text-neutral-500 font-medium">{label}</div>
  <div className="text-base font-semibold text-neutral-900 text-right">
    {value}
  </div>
</div>
```

**Usage:** Service details, pricing, technician info, date/time display

**Spacing:** Use `space-y-2` between multiple SummaryRow components

---

### SectionTitle

**Purpose:** Section headers within cards or pages

**Props:**
```tsx
interface SectionTitleProps {
  children: React.ReactNode;
  icon?: React.ReactNode; // Optional icon before title
  className?: string;
}
```

**Structure:**
```tsx
<div className="flex items-center gap-2 mb-3 px-1">
  {icon && <div className="text-[#d6a249]">{icon}</div>}
  <h3 className="text-base font-semibold text-neutral-900">{children}</h3>
</div>
```

**Usage:** "Choose Date", "Select Time", "Summary" sections

---

### PrimaryButton

**Purpose:** Main call-to-action buttons (gold background)

**Props:**
```tsx
interface PrimaryButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  fullWidth?: boolean; // Default: true
}
```

**Structure:**
```tsx
<button
  className={`${fullWidth ? 'w-full' : ''} rounded-full bg-[#f4b864] px-5 py-3.5 text-base font-bold text-neutral-900 shadow-sm transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-md active:scale-[0.97]`}
  {...props}
>
  {children}
</button>
```

**Usage:** "Choose technician", "View Appointment", "Apply" discount, primary actions

---

### SecondaryButton

**Purpose:** Secondary actions (neutral background)

**Props:**
```tsx
interface SecondaryButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  fullWidth?: boolean; // Default: true
}
```

**Structure:**
```tsx
<button
  className={`${fullWidth ? 'w-full' : ''} rounded-full bg-neutral-50 px-5 py-3.5 text-base font-semibold text-neutral-700 transition-all duration-200 ease-out hover:scale-[1.01] hover:bg-neutral-100 hover:shadow-sm active:scale-[0.98]`}
  {...props}
>
  {children}
</button>
```

**Usage:** "View Profile", "Edit", cancel actions, secondary CTAs

---

### FormInput

**Purpose:** Text input fields with consistent styling

**Props:**
```tsx
interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}
```

**Structure:**
```tsx
<input
  className={`flex-1 rounded-full bg-neutral-50 border border-neutral-200 px-4 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-[#d6a249] focus:ring-1 focus:ring-[#d6a249] transition-all ${
    error ? 'border-red-500' : ''
  }`}
  {...props}
/>
```

**Usage:** Phone number, discount codes, search inputs, any text input

---

### RewardInfoRow

**Purpose:** Display reward/points information with icon

**Props:**
```tsx
interface RewardInfoRowProps {
  points: number;
  message?: string; // Optional custom message
}
```

**Structure:**
```tsx
<div className="py-4">
  <p className="text-sm font-bold text-neutral-900">
    {message || "Thank you! We'll see you soon 💜"}
  </p>
  <p className="text-[13px] text-neutral-600 mt-1.5">
    You earned {points} points from this visit.
  </p>
</div>
```

**Usage:** Confirmation pages, rewards display, points earned notifications

---

### PointsBadge

**Purpose:** Small badge displaying points value

**Props:**
```tsx
interface PointsBadgeProps {
  points: number;
  size?: 'sm' | 'md'; // Default: 'sm'
}
```

**Structure:**
```tsx
<div className={`${size === 'md' ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-xs'} rounded-full bg-[#fef9e7] border border-[#d6a249]/30 font-semibold text-neutral-900`}>
  {points} pts
</div>
```

**Usage:** Profile pages, rewards pages, inline points display

---

### PageLayout

**Purpose:** Consistent page container wrapper

**Props:**
```tsx
interface PageLayoutProps {
  children: React.ReactNode;
  background?: string; // Default: '#f6ebdd'
  verticalPadding?: 'sm' | 'md' | 'lg'; // Default: 'md'
}
```

**Structure:**
```tsx
<div className={`min-h-screen ${background || 'bg-[#f6ebdd]'} flex justify-center pt-6 pb-10`}>
  <div className="mx-auto max-w-[430px] w-full px-4 flex flex-col gap-4">
    {children}
  </div>
</div>
```

**Usage:** Wrap all page content for consistent layout

---

## 7. Page Layout Patterns

### Book Service Page

**Structure:**
```
PageLayout
  ├─ Search Bar (rounded-full, white bg, shadow-sm)
  ├─ Category Tabs (centered, with gold underline for active)
  ├─ Services Grid (2-column, gap-2.5)
  │   └─ ServiceCard (rounded-2xl, image + info, selection state)
  ├─ Choose Technician Bar (white card, appears when services selected)
  └─ Auth Footer (white card, login/signup flow)
```

**Key Elements:**
- Search: `rounded-full bg-white shadow-sm px-4 py-2.5`
- Category tabs: `text-sm font-semibold`, active: `text-neutral-900` with gold `h-[2px]` underline
- Service cards: `rounded-2xl`, selected: `bg-[#f5e6d3] ring-2 ring-[#d6a249]`
- Selection badge: `absolute top-2 right-2 h-6 w-6 rounded-full bg-[#d6a249]` with white checkmark

---

### Book Technician Page

**Structure:**
```
PageLayout
  ├─ Top Bar (back button + centered title)
  └─ Technicians Grid (2-column, gap-3)
      └─ TechnicianCard (rounded-2xl, image + name + rating + specialties)
```

**Key Elements:**
- Top bar: Back button (left) + title `text-xl font-semibold text-[#7b4ea3]` (centered)
- Technician cards: `rounded-2xl bg-white`, selected: `bg-[#f5e6d3] ring-2 ring-[#d6a249]`
- Tech image: `h-20 w-20 rounded-full`
- Rating: Gold star icon `text-[#f4b864]` + `text-xs font-semibold`
- Checkmark: Same as service cards

---

### Select Time Page

**Structure:**
```
PageLayout
  ├─ Top Bar (back button + centered title)
  ├─ Booking Summary Card (white, gold accent bar, service + price + tech + duration)
  ├─ Encouraging Microcopy (text-xs, centered)
  ├─ Calendar Section
  │   └─ CalendarCard (white, month navigation + 7-column grid)
  ├─ Time Selection (3-column grid, rounded-full buttons)
  └─ Reassurance Footer (text-[10px], centered)
```

**Key Elements:**
- Summary card: Gold bar `h-1 bg-gradient-to-r from-[#d6a249] to-[#f4b864]`
- Calendar: Selected day = gold gradient, today = beige background with border
- Time slots: `rounded-full px-4 py-2.5 text-sm font-semibold`, hover: `hover:ring-2 hover:ring-[#d6a249]/50`

---

### Confirm Page

**Structure:**
```
PageLayout (centered, pt-6 pb-10)
  ├─ Large Gold Checkmark (w-28 h-28, with glow, animated)
  ├─ Page Title (text-3xl, #7b4ea3, animated)
  └─ MainCard (with gold bar)
      ├─ Summary Section (SummaryRow components, space-y-2)
      ├─ Discount Input Section (FormInput + PrimaryButton)
      ├─ RewardInfoRow
      └─ Buttons Area (PrimaryButton + SecondaryButton, gap-3)
```

**Key Elements:**
- Checkmark: Animated scale + opacity, 200ms
- Title: Animated translateY + opacity, 250ms, 220ms delay
- Card: Animated translateY + scale, 250ms, 300ms delay
- Gold bar: Width animation, 400ms, 350ms delay
- Highlight rows: Temporary `bg-[#fef9e7]` on discount application

---

### Rewards Page

**Structure:**
```
PageLayout
  ├─ Page Title (text-3xl, #7b4ea3)
  ├─ Points Summary Card (MainCard with large points display)
  ├─ Rewards List (grid or list of available rewards)
  └─ History Section (past redemptions, if applicable)
```

**Key Elements:**
- Points display: Large, bold, gold accent
- Reward cards: Similar to service cards, with PointsBadge
- Use SummaryRow for point breakdowns

---

### Profile Page

**Structure:**
```
PageLayout
  ├─ Profile Header (avatar + name + PointsBadge)
  ├─ Account Info Card (MainCard with SummaryRow components)
  ├─ Appointment History Card (list of past appointments)
  └─ Settings Section (preferences, notifications)
```

**Key Elements:**
- Avatar: `rounded-full`, large size
- Info rows: Use SummaryRow for consistent layout
- History items: Card-based list with date, service, status

---

### Appointment History Page

**Structure:**
```
PageLayout
  ├─ Page Title (text-3xl, #7b4ea3)
  └─ Appointment List
      └─ AppointmentCard (MainCard for each appointment)
          ├─ Date & Time (SectionTitle style)
          ├─ Service Details (SummaryRow)
          ├─ Technician (SummaryRow)
          └─ Actions (PrimaryButton/SecondaryButton)
```

**Key Elements:**
- Each appointment in its own MainCard
- Use SummaryRow for consistent data display
- Status badges: Use PointsBadge style but with status colors

---

### Invite Page

**Structure:**
```
PageLayout
  ├─ Page Title (text-3xl, #7b4ea3)
  ├─ Invite Code Card (MainCard with large code display)
  ├─ Share Buttons (PrimaryButton variants)
  └─ Benefits Section (why invite friends)
```

**Key Elements:**
- Invite code: Large, bold, gold accent
- Share buttons: Use PrimaryButton for main actions
- Benefits: Card-based list with icons

---

### Gallery Page

**Structure:**
```
PageLayout
  ├─ Page Title (text-3xl, #7b4ea3)
  └─ Image Grid (2-column or 3-column, gap-2.5)
      └─ GalleryImageCard (rounded-2xl, image + optional caption)
```

**Key Elements:**
- Grid: `grid grid-cols-2 gap-2.5` or `grid-cols-3`
- Images: `rounded-2xl`, aspect ratio maintained
- Captions: `text-xs text-neutral-600` below image

---

## 8. Key Decisions Summary

### Critical Standards for All Pages

**Card Width:**
- **Max width:** `430px` (never exceed)
- **Mobile:** `100%` width with `px-4` padding
- **Centering:** Always use `mx-auto` on container

**Typography:**
- **Page titles:** `text-3xl` (30px) or `text-xl` (20px), `font-semibold`, `#7b4ea3`
- **Section titles:** `text-base` (16px), `font-semibold`, `neutral-900`
- **Labels:** `text-sm` (14px), `font-medium`, `neutral-500`
- **Values:** `text-base` (16px), `font-semibold`, `neutral-900`
- **New Total row:** `text-[18px]` (18px), `font-bold`, `neutral-900`
- **Buttons:** `text-base` (16px), `font-bold` (primary) or `font-semibold` (secondary)
- **Subtext:** `text-[13px]` or `text-xs`, `neutral-600` or `neutral-500`

**Spacing:**
- **Page padding:** `pt-6 pb-10 px-4` (24px top, 40px bottom, 16px horizontal)
- **Card padding:** `px-5 py-6` (20px × 24px)
- **Section gaps:** `gap-4` (16px) between major page sections, `gap-5` (20px) between sections inside cards
- **Row spacing:** `space-y-2` (8px) within card sections
- **Button gaps:** `gap-3` (12px) between buttons

**Colors:**
- **Purple titles:** `#7b4ea3` (ONLY for page titles)
- **Gold buttons:** `#f4b864` (primary), `#d6a249` (selected/darker)
- **Background:** `#f6ebdd` (page), `white` (cards)
- **Text:** Neutral scale (900 → 400) for all body text

**Animations:**
- **Checkmark:** 200ms, scale + opacity
- **Staggered reveals:** 250ms, translateY + opacity, 220ms+ delays
- **Button hover:** `scale-[1.02]`, 200ms
- **Button press:** `scale-[0.97]`, 200ms
- **Card hover (desktop):** `translateY(-1px)`, shadow increase

**Component Consistency:**
- All cards use `rounded-2xl`, `bg-white`, `shadow-[0_4px_20px_rgba(0,0,0,0.08)]`
- All buttons use `rounded-full`
- All inputs use `rounded-full`, `bg-neutral-50`, gold focus ring
- All selections use gold ring (`ring-2 ring-[#d6a249]`) and beige background (`bg-[#f5e6d3]`)

---

## Implementation Checklist

When creating or updating any page, ensure:

- [ ] Card max width is `430px` (or `100%` on mobile)
- [ ] Page title uses `#7b4ea3` and correct typography scale
- [ ] All cards use `rounded-2xl`, white background, standard shadow
- [ ] Spacing follows the system (`gap-4`, `px-5 py-6`, etc.)
- [ ] Buttons use gold (`#f4b864`) for primary, neutral for secondary
- [ ] Text colors follow neutral hierarchy (900 → 400)
- [ ] Animations use specified durations and easing
- [ ] Hover effects only on desktop (≥768px)
- [ ] Selected states use gold ring and beige background
- [ ] All inputs use rounded-full with gold focus state

---

**Document Version:** 1.0  
**Last Updated:** 2025  
**Maintained by:** Design System Team

