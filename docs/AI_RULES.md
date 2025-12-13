# AI Behavioral Rules

## Cursor Development Guidelines

**Version:** 1.0
**Last Updated:** December 2024
**Purpose:** Define strict rules for AI-assisted development in this codebase

---

## Table of Contents

1. [Overview](#1-overview)
2. [Theme System Rules](#2-theme-system-rules)
3. [Animation Rules](#3-animation-rules)
4. [Component Rules](#4-component-rules)
5. [Multi-Tenancy Rules](#5-multi-tenancy-rules)
6. [Code Style Rules](#6-code-style-rules)
7. [What NOT To Do](#7-what-not-to-do)

---

## 1. Overview

### 1.1 Document Purpose

This document defines **mandatory rules** for Cursor AI when editing code in this project. These rules ensure:

- Consistent multi-tenant theming
- Preserved animations and micro-interactions
- Proper component usage
- Data isolation between tenants
- Maintainable code structure

### 1.2 Rule Severity

| Level | Meaning |
|-------|---------|
| 🔴 **MUST** | Mandatory - never violate |
| 🟠 **SHOULD** | Strongly recommended |
| 🟢 **MAY** | Optional, context-dependent |

### 1.3 Quick Reference

```
✅ DO:
- Use themeVars for all colors
- Preserve existing animations
- Use existing components
- Scope data to salonId
- Follow existing patterns

❌ DON'T:
- Hardcode hex colors
- Remove/simplify animations
- Create new abstractions unnecessarily
- Query data without tenant scope
- Refactor without explicit request
```

---

## 2. Theme System Rules

### 2.1 🔴 NEVER Hardcode Colors

All colors MUST come from theme tokens. Never use inline hex codes.

```typescript
// ❌ WRONG - Hardcoded colors
style={{ backgroundColor: '#f4b864' }}
className="bg-[#f4b864]"
className="text-purple-500"
className="border-amber-400"

// ✅ CORRECT - Theme tokens
import { themeVars } from '@/theme';

style={{ backgroundColor: themeVars.primary }}
style={{ color: themeVars.accent }}
className="bg-[var(--theme-primary)]"
className="text-[var(--theme-accent)]"
```

### 2.2 🔴 Use themeVars Object for Inline Styles

When using `style={{ }}` attributes, always import and use `themeVars`:

```typescript
import { themeVars } from '@/theme';

// Colors
style={{
  backgroundColor: themeVars.primary,
  color: themeVars.titleText,
  borderColor: themeVars.cardBorder,
}}

// Gradients
style={{
  background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`,
}}

// Color mixing (for transparency)
style={{
  backgroundColor: `color-mix(in srgb, ${themeVars.primary} 20%, transparent)`,
}}
```

### 2.3 🔴 Use CSS Variables for Tailwind Arbitrary Values

When using Tailwind arbitrary values, reference CSS variables:

```typescript
// ❌ WRONG
className = 'bg-[#f4b864]';

// ✅ CORRECT
className = 'bg-[var(--theme-primary)]';
className = 'text-[var(--theme-title-text)]';
className = 'border-[var(--theme-card-border)]';
```

### 2.4 🟠 Available Theme Tokens

Reference these tokens by their names:

| Token | Usage |
|-------|-------|
| `themeVars.primary` | Buttons, primary accents |
| `themeVars.primaryDark` | Selection rings, gradients |
| `themeVars.accent` | Page titles, secondary actions |
| `themeVars.accentLight` | Light accent for gradients |
| `themeVars.background` | Page background |
| `themeVars.cardBackground` | Card backgrounds |
| `themeVars.surfaceAlt` | Alternative surface |
| `themeVars.selectedBackground` | Selected card background |
| `themeVars.accentSelected` | Purple selected state |
| `themeVars.inputBackground` | Form inputs |
| `themeVars.highlightBackground` | Points/discount highlight |
| `themeVars.cardBorder` | Card borders |
| `themeVars.borderMuted` | Muted borders |
| `themeVars.selectedRing` | Selection ring color |
| `themeVars.titleText` | Page title color |

### 2.5 🔴 New Components Must Support Theming

Any new component MUST use theme tokens, not hardcoded colors:

```typescript
// ❌ WRONG - New component with hardcoded colors
export function NewCard({ children }) {
  return (
    <div className="bg-white border-[#e6d6c2] rounded-2xl">
      {children}
    </div>
  );
}

// ✅ CORRECT - New component with theme tokens
import { themeVars } from '@/theme';

export function NewCard({ children }) {
  return (
    <div
      className="rounded-2xl bg-white"
      style={{ borderColor: themeVars.cardBorder, borderWidth: 1 }}
    >
      {children}
    </div>
  );
}
```

---

## 3. Animation Rules

### 3.1 🔴 STRICT Preservation of Animations

Animations are part of the brand identity. You MUST:

- **Keep** all existing Framer Motion components
- **Preserve** exact timing, easing, and delays
- **Maintain** all micro-interactions
- **Never** remove animations without explicit instruction

### 3.2 🔴 Do NOT Simplify or Remove Animations

```typescript
// ❌ WRONG - Removing animation
<div className="rounded-2xl bg-white">

// ✅ CORRECT - Preserving animation
<div
  className="rounded-2xl bg-white"
  style={{
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'translateY(0)' : 'translateY(10px)',
    transition: 'opacity 300ms ease-out, transform 300ms ease-out',
  }}
>
```

### 3.3 🔴 Preserve Animation Timing

Do not modify these established patterns:

```typescript
// Standard stagger delays
Element 1: 0ms
Element 2: 50ms
Element 3: 100ms
Grid items: 200ms + (index * 50)ms

// Standard durations
Page transitions: 300ms
Card selection: 200-300ms
Button hover/press: 200ms
Success checkmark: 500ms
Confetti: 2500ms

// Standard easing
Primary: ease-out
Bounce: custom keyframes
```

### 3.4 🔴 Preserve Success/Celebration Animations

The confirm page has specific celebration animations that MUST be preserved:

- Checkmark bounce-in
- Pulse glow effect
- Confetti burst
- Sparkle effects
- Title slide-up
- Emoji bounce
- Card slide-up
- Staggered detail reveals

### 3.5 🟠 Animation Pattern Reference

When adding new animated elements, follow these patterns:

```typescript
// Page load fade + slide
const [mounted, setMounted] = useState(false);
useEffect(() => { setMounted(true); }, []);

style={{
  opacity: mounted ? 1 : 0,
  transform: mounted ? 'translateY(0)' : 'translateY(10px)',
  transition: 'opacity 300ms ease-out, transform 300ms ease-out',
}}

// Staggered grid items
style={{
  opacity: mounted ? 1 : 0,
  transform: mounted ? 'translateY(0)' : 'translateY(15px)',
  transition: `opacity 300ms ease-out ${200 + index * 50}ms, transform 300ms ease-out ${200 + index * 50}ms`,
}}

// Button micro-interaction
className="transition-all duration-200 hover:scale-[1.02] active:scale-[0.97]"
```

---

## 4. Component Rules

### 4.1 🔴 Use Existing Components

Before creating new components, check if these exist:

| Component | Usage |
|-----------|-------|
| `MainCard` | Primary card container with optional gold bar |
| `SummaryRow` | Label-value display pairs |
| `SectionTitle` | Section headers with optional icon |
| `PrimaryButton` | Gold call-to-action buttons |
| `SecondaryButton` | Neutral secondary buttons |
| `Button` | Unified button with variants |
| `FormInput` | Styled form inputs |
| `PointsBadge` | Points display badge |
| `PageLayout` | Page container wrapper |
| `ProgressSteps` | Booking flow progress |
| `BlockingLoginModal` | Authentication modal |

### 4.2 🔴 Follow Card Standards

All cards MUST follow these specifications:

```typescript
// Required card styles
className="rounded-2xl bg-white"
style={{
  borderWidth: 1,
  borderColor: themeVars.cardBorder,
  boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
}}

// Max width constraint
<div className="mx-auto max-w-[430px] w-full">
```

### 4.3 🔴 Follow Button Standards

**Primary buttons (gold):**
```typescript
<button
  className="rounded-full px-5 py-3.5 font-bold transition-all duration-200 hover:scale-[1.02] active:scale-[0.97]"
  style={{
    background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`,
    color: '#171717',
  }}
>
```

**Secondary buttons (neutral):**
```typescript
<button
  className="rounded-full bg-neutral-50 px-5 py-3.5 font-semibold text-neutral-700 transition-all duration-200 hover:scale-[1.01] hover:bg-neutral-100 active:scale-[0.98]"
>
```

### 4.4 🔴 Follow Input Standards

```typescript
<input
  className="rounded-full bg-neutral-50 px-4 py-2.5 text-sm outline-none transition-all"
  style={{
    borderWidth: 1,
    borderColor: '#e5e5e5',
  }}
  onFocus={(e) => {
    e.currentTarget.style.borderColor = themeVars.selectedRing;
  }}
  onBlur={(e) => {
    e.currentTarget.style.borderColor = '#e5e5e5';
  }}
/>
```

### 4.5 🟠 Selection States

Cards and buttons with selection states:

```typescript
style={{
  transform: isSelected ? 'scale(1.02)' : undefined,
  background: isSelected
    ? `linear-gradient(to bottom right, color-mix(in srgb, ${themeVars.primary} 20%, transparent), ...)`
    : 'white',
  outline: isSelected ? `2px solid ${themeVars.primary}` : undefined,
}}
```

---

## 5. Multi-Tenancy Rules

### 5.1 🔴 ALWAYS Scope Queries to Salon

Every database query MUST include salonId filtering:

```typescript
// ❌ WRONG - No tenant scope (data leak!)
const services = await db.select().from(servicesTable);

// ✅ CORRECT - Scoped to current salon
const services = await db
  .select()
  .from(servicesTable)
  .where(eq(servicesTable.salonId, currentSalonId));
```

### 5.2 🔴 Use SalonProvider Context

Access salon information through the provider:

```typescript
import { useSalon } from '@/providers/SalonProvider';

function MyComponent() {
  const { salonName } = useSalon();
  return <div>{salonName}</div>;
}
```

### 5.3 🔴 Never Expose Cross-Tenant Data

- Never return data from other salons
- Never allow modifying other salon's data
- Validate salonId on all mutations
- Log attempted cross-tenant access

### 5.4 🟠 Tenant Context in API Routes

```typescript
// Future API route pattern
export async function GET(request: Request) {
  const salonId = await getCurrentSalonId(request);

  if (!salonId) {
    return Response.json({ error: 'Salon not found' }, { status: 404 });
  }

  const services = await db
    .select()
    .from(servicesTable)
    .where(eq(servicesTable.salonId, salonId));

  return Response.json({ data: services });
}
```

---

## 6. Code Style Rules

### 6.1 🔴 Follow Existing File Structure

Do not reorganize files without explicit instruction:

```
src/
├── app/           # Next.js pages (don't add components here)
├── components/    # Reusable UI components
├── providers/     # React context providers
├── theme/         # Theme system
├── hooks/         # Custom React hooks
├── libs/          # Utility libraries
├── utils/         # Helper functions
└── types/         # TypeScript types
```

### 6.2 🔴 Preserve Existing Patterns

When adding similar functionality, follow existing patterns:

```typescript
// Follow existing naming conventions
const [mounted, setMounted] = useState(false);
const [authState, setAuthState] = useState<AuthState>('loggedOut');

// Follow existing hook patterns
useEffect(() => { setMounted(true); }, []);

// Follow existing style patterns
style={{
  opacity: mounted ? 1 : 0,
  transform: mounted ? 'translateY(0)' : 'translateY(10px)',
  transition: 'opacity 300ms ease-out, transform 300ms ease-out',
}}
```

### 6.3 🟠 TypeScript Conventions

- Use explicit types for function parameters
- Define interfaces for component props
- Use `as const` for constant arrays
- Prefer `type` over `interface` for unions

```typescript
type AuthState = 'loggedOut' | 'verify' | 'loggedIn';
type Category = 'hands' | 'feet' | 'combo';

type ServiceCardProps = {
  service: Service;
  isSelected: boolean;
  onSelect: (id: string) => void;
};
```

### 6.4 🟠 Import Ordering

```typescript
// 1. React/Next
// 2. Third-party libraries
import { motion } from 'framer-motion';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

// 4. Internal - components
import { MainCard } from '@/components/MainCard';
import { PrimaryButton } from '@/components/PrimaryButton';
// 3. Internal - providers/hooks
import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';
import type { Service } from '@/types';
// 5. Internal - utils/types
import { cn } from '@/utils/Helpers';
```

### 6.5 🔴 No Unnecessary Refactoring

Do NOT refactor code that wasn't explicitly requested:

```typescript
// ❌ WRONG - Refactoring without request
// "I noticed this could be cleaner, so I refactored..."

// ✅ CORRECT - Only make requested changes
// Focus on the specific task at hand
```

---

## 7. What NOT To Do

### 7.1 🔴 Do NOT Remove or Simplify Animations

```typescript
// ❌ NEVER do this
// "I simplified the animation for better performance"
// "I removed the confetti as it seemed unnecessary"
// "I replaced the stagger with a simple fade"
```

### 7.2 🔴 Do NOT Hardcode Colors

```typescript
// ❌ NEVER do this
className="bg-amber-400"
className="text-purple-600"
style={{ backgroundColor: '#f4b864' }}
```

### 7.3 🔴 Do NOT Create Unnecessary Abstractions

```typescript
// ❌ NEVER do this
// "I created a useAnimation hook to centralize..."
// "I extracted a ThemeColorHelper class..."
// Unless explicitly requested
```

### 7.4 🔴 Do NOT Query Without Tenant Scope

```typescript
// ❌ NEVER do this
const allServices = await db.select().from(services);
// This leaks data across tenants!
```

### 7.5 🔴 Do NOT Add Third-Party Auth Providers

```typescript
// ❌ NEVER do this
// "I added Clerk for easier authentication"
// "I integrated Auth0 for better security"
// The app uses custom phone-first OTP auth ONLY
```

### 7.6 🔴 Do NOT Use Clerk Components

```typescript
// ❌ NEVER import or use
import { SignIn, UserButton } from '@clerk/nextjs';
// The app does NOT use Clerk
```

### 7.7 🟠 Do NOT Over-Engineer

```typescript
// ❌ Avoid this
// "I added a factory pattern for future extensibility"
// "I created an abstract base class for buttons"

// ✅ Keep it simple
// Follow existing patterns, minimal abstractions
```

---

## Summary Checklist

Before committing any code, verify:

- [ ] All colors use `themeVars.*` or CSS variables
- [ ] All existing animations are preserved
- [ ] Existing components are used where applicable
- [ ] Database queries are scoped to `salonId`
- [ ] No hardcoded hex color values
- [ ] No unnecessary refactoring
- [ ] No new third-party auth providers
- [ ] Code follows existing file structure
- [ ] TypeScript types are explicit
- [ ] Imports are properly ordered

---

## Related Documents

- [PRD](./PRD.md) - Product requirements
- [Technical Spec](./TECHNICAL_SPEC.md) - Architecture details
- [UI/UX Spec](./UI_UX_SPEC.md) - Design patterns
- [Design System](../design-system.md) - Visual specifications
