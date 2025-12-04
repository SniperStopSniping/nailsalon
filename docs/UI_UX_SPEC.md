# UI/UX Specification

## Nail Salon Booking Platform

**Version:** 1.0
**Last Updated:** December 2024
**Status:** Active Development

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Design System Reference](#2-design-system-reference)
3. [Core User Flows](#3-core-user-flows)
4. [Animation Specifications](#4-animation-specifications)
5. [Component Patterns](#5-component-patterns)
6. [Responsive Strategy](#6-responsive-strategy)
7. [Accessibility Guidelines](#7-accessibility-guidelines)

---

## 1. Design Philosophy

### 1.1 Core Principles

| Principle | Description |
|-----------|-------------|
| **Luxury Aesthetic** | Apple/Tesla-inspired clean, premium feel |
| **Mobile-First** | Optimized for phone booking experience |
| **Delightful Interactions** | Smooth animations, micro-interactions, celebrations |
| **Theme Flexibility** | Multi-tenant support via dynamic theming |
| **Clarity Over Cleverness** | Clear hierarchy, intuitive navigation |

### 1.2 Visual Identity

The default theme (Nail Salon No.5) establishes the luxury spa aesthetic:

- **Primary Color (Gold):** `#f4b864` - Warmth, luxury, call-to-action
- **Accent Color (Purple):** `#7b4ea3` - Elegance, titles, secondary emphasis
- **Background (Warm Beige):** `#f6ebdd` - Soft, spa-like atmosphere
- **Typography:** Clean, readable, hierarchical

### 1.3 Emotional Goals

| Flow Stage | Emotion | Design Response |
|------------|---------|-----------------|
| Browsing services | Excitement | Attractive imagery, clear pricing |
| Choosing technician | Trust | Ratings, specialties, friendly photos |
| Picking time | Confidence | Clear calendar, easy time selection |
| Confirming | Delight | Confetti, celebration, reassurance |

---

## 2. Design System Reference

> **Full Reference:** See [design-system.md](../design-system.md) for complete specifications.

### 2.1 Typography Scale

| Element | Size | Weight | Color | Usage |
|---------|------|--------|-------|-------|
| Page Title | `text-3xl` (30px) | semibold (600) | `#7b4ea3` (accent) | Main page headlines |
| Section Title | `text-base` (16px) | semibold (600) | neutral-900 | Card section headers |
| Label | `text-sm` (14px) | medium (500) | neutral-500 | Form labels, metadata |
| Value | `text-base` (16px) | semibold (600) | neutral-900 | Important data display |
| Body | `text-base` (16px) | normal (400) | neutral-700 | Paragraph text |
| Caption | `text-xs` (12px) | medium (500) | neutral-500 | Fine print, timestamps |

### 2.2 Color System (Theme Tokens)

**Always use theme tokens, never hardcode colors:**

```typescript
import { themeVars } from '@/theme';

// ✅ Correct
style={{ backgroundColor: themeVars.primary }}
className="bg-[var(--theme-primary)]"

// ❌ Wrong
style={{ backgroundColor: '#f4b864' }}
className="bg-[#f4b864]"
```

| Token | CSS Variable | Default | Usage |
|-------|-------------|---------|-------|
| `primary` | `--theme-primary` | `#f4b864` | Buttons, accents |
| `primaryDark` | `--theme-primary-dark` | `#d6a249` | Selection rings, gradients |
| `accent` | `--theme-accent` | `#7b4ea3` | Page titles, secondary actions |
| `background` | `--theme-background` | `#f6ebdd` | Page background |
| `cardBorder` | `--theme-card-border` | `#e6d6c2` | Card borders |

### 2.3 Spacing System

| Context | Value | Pixels | Usage |
|---------|-------|--------|-------|
| Page padding | `px-4` | 16px | Horizontal page margins |
| Page top | `pt-6` | 24px | Top of page content |
| Page bottom | `pb-10` | 40px | Bottom of page content |
| Card padding | `px-5 py-6` | 20px × 24px | Inside cards |
| Section gap | `gap-4` | 16px | Between major sections |
| Row spacing | `space-y-2` | 8px | Between rows in cards |
| Button gap | `gap-3` | 12px | Between stacked buttons |

### 2.4 Card Standards

```
┌─────────────────────────────────┐
│  Gold Accent Bar (optional)     │ ← h-1, gradient primary
├─────────────────────────────────┤
│  Content                        │ ← px-5 py-6
│  • Rounded: rounded-2xl         │
│  • Background: white            │
│  • Border: border-[cardBorder]  │
│  • Shadow: shadow-[0_4px_20px]  │
│  • Max width: 430px             │
└─────────────────────────────────┘
```

### 2.5 Button Styles

**Primary Button (Gold):**
- Background: `themeVars.primary` with gradient to `primaryDark`
- Text: neutral-900, font-bold
- Radius: `rounded-full`
- Hover: `scale-[1.02]`, shadow increase
- Press: `scale-[0.97]`

**Secondary Button (Neutral):**
- Background: neutral-50 or white
- Text: neutral-700, font-semibold
- Border: neutral-200
- Hover: `scale-[1.01]`, bg-neutral-100
- Press: `scale-[0.98]`

---

## 3. Core User Flows

### 3.1 Booking Flow Overview

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ Service  │ → │   Tech   │ → │   Time   │ → │ Confirm  │ → │ Success  │
│ Selection│   │ Selection│   │ Selection│   │  Review  │   │Animation │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
     │              │              │              │              │
  Multi-      Single pick      Calendar +     Summary +      Confetti +
  select      (or "any")      time slots     CTA buttons     sparkles
```

### 3.2 Step 1: Service Selection

**Route:** `/[locale]/book/service`

**Screen Layout:**
```
┌─────────────────────────────────┐
│         Salon Name              │ ← Accent color, centered
├─────────────────────────────────┤
│  ① Service  ② Artist  ③ Time  ④ │ ← Progress steps
├─────────────────────────────────┤
│  🔍 Search services...          │ ← Search input
├─────────────────────────────────┤
│  💅 Hands  🦶 Feet  ✨ Combo    │ ← Category tabs
├─────────────────────────────────┤
│  ┌─────┐  ┌─────┐               │
│  │ Svc │  │ Svc │               │ ← 2-column grid
│  │ $65 │  │ $75 │               │
│  └─────┘  └─────┘               │
│  ┌─────┐  ┌─────┐               │
│  │ Svc │  │ Svc │               │
│  │ $90 │  │ $75 │               │
│  └─────┘  └─────┘               │
├─────────────────────────────────┤
│  Auth Footer (login prompt)     │ ← MainCard
└─────────────────────────────────┘
│                                 │
│  ┌───────────────────────────┐  │ ← Fixed bottom bar
│  │ 2 services    [Continue →]│  │    (when selection)
│  │ $140                      │  │
│  └───────────────────────────┘  │
```

**Selection Mode: Multi-Select**

Clients can choose **multiple services** in a single booking (e.g., "BIAB Short + Gel Pedicure"). Selected services are combined with a running total displayed in the fixed bottom bar. This maps to the `appointment_services` junction table in the database.

**Key Interactions:**
- **Service card tap:** Toggle selection with checkmark (add/remove from selection)
- **Category tab:** Filter services, clear search
- **Search:** Filter across all categories
- **Continue:** Navigate to tech (requires auth if not logged in)

**Visual States:**
- **Unselected card:** White bg, subtle border, shadow
- **Selected card:** Beige tint bg, gold ring, checkmark badge
- **Category inactive:** White bg, border
- **Category active:** Accent bg, white text

### 3.3 Step 2: Technician Selection

**Route:** `/[locale]/book/tech?serviceIds=...`

**Screen Layout:**
```
┌─────────────────────────────────┐
│  ←  │    Salon Name      │      │ ← Back button + title
├─────────────────────────────────┤
│  ① ✓  ② Artist  ③ Time  ④      │ ← Progress (step 2)
├─────────────────────────────────┤
│  ┌─────────────────────────────┐│
│  │  You selected: BIAB Short   ││ ← Summary card
│  │                       $65   ││   (accent gradient)
│  └─────────────────────────────┘│
├─────────────────────────────────┤
│       Choose Your Artist        │ ← Title
│   Select your favorite tech     │ ← Subtitle
├─────────────────────────────────┤
│  ┌─────┐  ┌─────┐               │
│  │ 😊  │  │ 😊  │               │ ← 2-column grid
│  │ Kim │  │ Amy │               │   Avatar + info
│  │ ⭐4.8│  │ ⭐4.9│               │
│  └─────┘  └─────┘               │
│  ┌─────┐                        │
│  │ 😊  │                        │
│  │ Jen │                        │
│  │ ⭐4.7│                        │
│  └─────┘                        │
├─────────────────────────────────┤
│  🎲 Surprise me with any artist │ ← Dashed border option
└─────────────────────────────────┘
```

**Key Interactions:**
- **Tech card tap:** Select and auto-navigate to time (300ms delay)
- **Back button:** Return to service selection
- **"Any" option:** Random assignment

**Visual States:**
- **Unselected tech:** White bg, border
- **Selected tech:** Gold tint bg, gold ring, scale up, checkmark

### 3.4 Step 3: Time Selection

**Route:** `/[locale]/book/time?serviceIds=...&techId=...`

**Screen Layout:**
```
┌─────────────────────────────────┐
│  ←  │    Salon Name      │      │
├─────────────────────────────────┤
│  ① ✓  ② ✓  ③ Time  ④           │ ← Progress (step 3)
├─────────────────────────────────┤
│  ┌─────────────────────────────┐│
│  │ 😊 Your appointment         ││ ← Summary card
│  │    BIAB Short with Daniela  ││   (accent gradient)
│  │    75 min           $65     ││
│  └─────────────────────────────┘│
├─────────────────────────────────┤
│        Pick Your Time           │
│  Thursday, Dec 15 · Tap to change
├─────────────────────────────────┤
│  ┌─────────────────────────────┐│
│  │  ◀  December 2024  ▶        ││ ← Calendar
│  │  S  M  T  W  T  F  S        ││
│  │        1  2  3  4  5        ││
│  │  6  7  8  9 10 11 12        ││
│  │ 13 14 [15]16 17 18 19       ││ ← Selected = gold
│  │ 20 21 22 23 24 25 26        ││
│  │ 27 28 29 30 31              ││
│  └─────────────────────────────┘│
├─────────────────────────────────┤
│  ┌─────────────────────────────┐│
│  │ 🌅 Morning  9:00 AM - 12 PM ││ ← Time section
│  │ [9:00] [9:30] [10:00]       ││   3-column grid
│  │ [10:30] [11:00] [11:30]     ││
│  └─────────────────────────────┘│
│  ┌─────────────────────────────┐│
│  │ ☀️ Afternoon  12 PM - 6 PM  ││
│  │ [12:00] [12:30] [1:00] ...  ││
│  └─────────────────────────────┘│
└─────────────────────────────────┘
```

**Key Interactions:**
- **Date tap:** Select date, show time slots
- **Month arrows:** Navigate months
- **Time slot tap:** Navigate to confirm

**Visual States:**
- **Today:** Accent bg (purple), white text
- **Selected date:** Gold gradient, scale up, shadow
- **Past dates:** Disabled, gray text
- **Time slot hover:** Gold gradient bg

### 3.5 Step 4: Confirmation + Success

**Route:** `/[locale]/book/confirm?serviceIds=...&techId=...&date=...&time=...`

**Screen Layout (after animation):**
```
┌─────────────────────────────────┐
│            ✨ 🎉 ✨               │ ← Confetti
├─────────────────────────────────┤
│           ┌─────┐               │
│           │  ✓  │               │ ← Large checkmark
│           └─────┘               │   Gold circle, glow
│                                 │
│      You're All Set! 💅         │ ← Title, emoji bounce
│   Your appointment is confirmed │
├─────────────────────────────────┤
│  ┌─────────────────────────────┐│
│  │ ████████████████████████████││ ← Purple header
│  │  😊 Your nail artist        ││   with tech photo
│  │      Daniela         $65    ││
│  │─────────────────────────────││
│  │ 💅 Service                  ││ ← Appointment details
│  │    BIAB Short    75 min     ││
│  │ 📅 When                     ││
│  │    Thursday, Dec 15         ││
│  │    10:00 AM                 ││
│  │─────────────────────────────││
│  │ ⭐ You'll earn +7 points    ││ ← Rewards teaser
│  │    [View Rewards →]         ││
│  └─────────────────────────────┘│
├─────────────────────────────────┤
│  [💳 Pay Now · $65            ] │ ← Gold button
│          or pay at salon        │
│  [View or Change Appointment  ] │ ← Accent outline btn
│       Back to Profile →         │ ← Text link
└─────────────────────────────────┘
```

**Animation Sequence:**
1. **0ms:** Checkmark bounces in with scale
2. **300ms:** Pulse glow effect
3. **400ms:** Confetti burst from top
4. **500ms:** Sparkles appear around checkmark
5. **600ms:** Title slides up with emoji bounce
6. **900ms:** Card slides up
7. **1100ms:** Details fade in
8. **1400ms:** Buttons appear

---

## 4. Animation Specifications

### 4.1 Animation Principles

| Principle | Implementation |
|-----------|----------------|
| **Purposeful** | Every animation serves a purpose (feedback, delight, guidance) |
| **Consistent** | Same patterns across similar interactions |
| **Performant** | 60fps, CSS-based where possible |
| **Interruptible** | User can continue without waiting |

### 4.2 Page Load Stagger Pattern

**Standard page entry animation:**

```typescript
// Mounted state pattern
const [mounted, setMounted] = useState(false);
useEffect(() => { setMounted(true); }, []);

// Element 1: Immediate
style={{
  opacity: mounted ? 1 : 0,
  transform: mounted ? 'translateY(0)' : 'translateY(-8px)',
  transition: 'opacity 300ms ease-out, transform 300ms ease-out',
}}

// Element 2: 50ms delay
style={{
  opacity: mounted ? 1 : 0,
  transition: 'opacity 300ms ease-out 50ms',
}}

// Element 3: 100ms delay
style={{
  opacity: mounted ? 1 : 0,
  transform: mounted ? 'translateY(0)' : 'translateY(10px)',
  transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
}}

// Grid items: Staggered by index
style={{
  opacity: mounted ? 1 : 0,
  transform: mounted ? 'translateY(0)' : 'translateY(15px)',
  transition: `opacity 300ms ease-out ${200 + index * 50}ms, transform 300ms ease-out ${200 + index * 50}ms`,
}}
```

### 4.3 Button Micro-interactions

**Primary Button:**
```css
transition: all 200ms ease-out;

/* Hover */
transform: scale(1.02);
box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);

/* Active/Press */
transform: scale(0.97);
```

**Secondary Button:**
```css
transition: all 200ms ease-out;

/* Hover */
transform: scale(1.01);
background-color: rgb(245 245 245);

/* Active/Press */
transform: scale(0.98);
```

### 4.4 Card Selection Animation

```typescript
// Selected state
style={{
  transform: isSelected ? 'scale(1.02)' : undefined,
  background: isSelected
    ? `linear-gradient(to bottom right, color-mix(in srgb, ${themeVars.primary} 20%, transparent), ...)`
    : 'white',
  boxShadow: isSelected
    ? '0 10px 15px -3px rgb(0 0 0 / 0.1)'
    : '0 4px 20px rgba(0,0,0,0.06)',
  outline: isSelected ? `2px solid ${themeVars.primary}` : undefined,
  transition: 'transform 300ms ease-out, box-shadow 200ms ease-out, ...',
}}
```

### 4.5 Success Celebration Animations

**Checkmark Bounce:**
```css
@keyframes bounce-in {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  50% {
    transform: scale(1.2);
  }
  70% {
    transform: scale(0.9);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

animation: bounce-in 0.5s ease-out forwards;
```

**Confetti Fall:**
```css
@keyframes confetti-fall {
  0% {
    transform: translateY(0) rotate(0deg) scale(1);
    opacity: 1;
  }
  100% {
    transform: translateY(100vh) rotate(720deg) scale(0.5);
    opacity: 0;
  }
}

animation: confetti-fall 2.5s ease-out forwards;
```

**Sparkle:**
```css
@keyframes sparkle {
  0% {
    transform: scale(0) rotate(0deg);
    opacity: 0;
  }
  50% {
    transform: scale(1.2) rotate(180deg);
    opacity: 1;
  }
  100% {
    transform: scale(0) rotate(360deg);
    opacity: 0;
  }
}

animation: sparkle 1s ease-out forwards;
```

**Pulse Glow:**
```css
@keyframes pulse-glow {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, ${themeVars.primary} 70%, transparent);
  }
  50% {
    box-shadow: 0 0 0 20px transparent;
  }
}
```

**Emoji Bounce:**
```css
@keyframes emoji-bounce {
  0%,
  100% {
    transform: scale(1);
  }
  25% {
    transform: scale(1.3) rotate(-10deg);
  }
  50% {
    transform: scale(1.1) rotate(10deg);
  }
  75% {
    transform: scale(1.2) rotate(-5deg);
  }
}
```

### 4.6 Animation Timing Reference

| Animation | Duration | Easing | Delay |
|-----------|----------|--------|-------|
| Page fade-in | 300ms | ease-out | 0-200ms staggered |
| Card selection | 200-300ms | ease-out | 0 |
| Button hover | 200ms | ease-out | 0 |
| Button press | 100ms | ease-out | 0 |
| Checkmark | 500ms | ease-out | 100ms |
| Confetti | 2500ms | ease-out | 400ms |
| Slide up | 400ms | ease-out | varied |
| Gold bar wipe | 400ms | ease-out | 350ms |

---

## 5. Component Patterns

### 5.1 MainCard

Primary container for card-based content.

```typescript
<MainCard showGoldBar={true} animateGoldBar={true}>
  <div className="space-y-4">
    {/* Card content */}
  </div>
</MainCard>
```

**Props:**
- `showGoldBar`: Display gold gradient bar at top
- `animateGoldBar`: Animate bar width on mount
- `className`: Additional classes

### 5.2 SummaryRow

Label-value display for receipts and summaries.

```typescript
<SummaryRow
  label="Service"
  value="BIAB Short"
  highlight={discountApplied}
/>
```

### 5.3 Progress Steps

Booking progress indicator.

```typescript
const STEPS = ['Service', 'Artist', 'Time', 'Confirm'];

{STEPS.map((step, i) => (
  <div className={`flex items-center gap-1.5 ${i === currentStep ? 'opacity-100' : 'opacity-40'}`}>
    <div
      className="flex size-6 items-center justify-center rounded-full text-xs font-bold"
      style={{
        backgroundColor: i < currentStep ? themeVars.accent : i === currentStep ? themeVars.primary : '#d4d4d4',
        color: i < currentStep ? 'white' : i === currentStep ? '#171717' : '#525252',
      }}
    >
      {i < currentStep ? '✓' : i + 1}
    </div>
    <span className={`text-xs font-medium ${i === currentStep ? 'text-neutral-900' : 'text-neutral-500'}`}>
      {step}
    </span>
  </div>
))}
```

### 5.4 Service Card Pattern

```typescript
<button
  onClick={() => toggleService(service.id)}
  className="relative overflow-hidden rounded-2xl text-left transition-all duration-200"
  style={{
    background: isSelected ? `linear-gradient(...)` : 'white',
    outline: isSelected ? `2px solid ${themeVars.primary}` : undefined,
    // ... other styles
  }}
>
  {/* Image */}
  <div className="relative h-[120px] overflow-hidden">
    <Image src={service.imageUrl} alt={service.name} fill className="object-cover" />
    {isSelected && (
      <div className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full"
           style={{ background: `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})` }}>
        <svg>...</svg> {/* Checkmark */}
      </div>
    )}
  </div>

  {/* Info */}
  <div className="p-3">
    <div className="text-base font-bold text-neutral-900">{service.name}</div>
    <div className="mt-2 flex items-center justify-between">
      <span className="text-sm text-neutral-500">{service.duration} min</span>
      <span className="text-base font-bold" style={{ color: themeVars.accent }}>${service.price}</span>
    </div>
  </div>
</button>
```

### 5.5 Fixed Bottom Bar Pattern

```typescript
{selectedCount > 0 && (
  <div className="fixed inset-x-0 bottom-0 z-50 bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.1)]"
       style={{ borderTop: `1px solid ${themeVars.cardBorder}` }}>
    <style jsx>{`
      @keyframes slideUp {
        from { transform: translateY(100%); }
        to { transform: translateY(0); }
      }
    `}</style>
    <div className="mx-auto flex max-w-[430px] items-center justify-between p-4">
      <div>
        <div className="text-sm text-neutral-500">{selectedCount} service(s)</div>
        <div className="text-xl font-bold text-neutral-900">${totalPrice}</div>
      </div>
      <button className="flex items-center gap-2 rounded-full px-6 py-3 font-bold"
              style={{ background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` }}>
        Continue →
      </button>
    </div>
  </div>
)}
```

---

## 6. Responsive Strategy

### 6.1 Mobile-First Approach

The app is designed for mobile (phone) as the primary experience:

```typescript
// Base container
<div className="mx-auto max-w-[430px] w-full px-4">
```

| Breakpoint | Width | Usage |
|------------|-------|-------|
| **Mobile** | < 430px | Full width, primary design |
| **Tablet/Desktop** | ≥ 430px | Centered, max-width constrained |

### 6.2 Touch Targets

All interactive elements meet minimum touch targets:

- **Buttons:** min 44px height
- **Cards:** Full card is tappable
- **Calendar days:** 44px × 44px
- **Time slots:** min 44px height

### 6.3 Safe Area Handling

```typescript
// Bottom fixed bar with safe area
<div className="h-[env(safe-area-inset-bottom)]" />
```

### 6.4 Desktop Hover States

Hover effects only apply on desktop (no hover on touch devices):

```typescript
// Check for desktop before applying hover lift
onMouseEnter={(e) => {
  if (window.innerWidth >= 768) {
    e.currentTarget.style.transform = 'translateY(-1px)';
  }
}}
```

---

## 7. Accessibility Guidelines

### 7.1 Semantic HTML

- Use `<button>` for clickable actions
- Use `<a>` for navigation links
- Use heading hierarchy (`h1` → `h2` → `h3`)
- Use `<label>` for form inputs

### 7.2 ARIA Labels

```typescript
// Back button
<button aria-label="Go back">
  <svg aria-hidden="true">...</svg>
</button>

// Close button
<button aria-label="Clear search">
  <svg aria-hidden="true">...</svg>
</button>

// Calendar navigation
<button aria-label="Previous month">...</button>
<button aria-label="Next month">...</button>
```

### 7.3 Focus Management

- Visible focus indicators
- Logical tab order
- Auto-focus on modal open
- Return focus on modal close

### 7.4 Color Contrast

- Text meets WCAG AA contrast ratios
- Don't rely solely on color to convey information
- Selection states include border/outline in addition to color

### 7.5 Motion Preferences

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Related Documents

- [PRD](./PRD.md) - Product requirements
- [Technical Spec](./TECHNICAL_SPEC.md) - Architecture details
- [AI Rules](./AI_RULES.md) - Development constraints
- [Design System](../design-system.md) - Complete visual specifications
