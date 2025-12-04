# Component Architecture

## Nail Salon Booking Platform

**Version:** 1.0  
**Last Updated:** December 2024

---

## Table of Contents

1. [File Placement Rules](#1-file-placement-rules)
2. [Component Hierarchy](#2-component-hierarchy)
3. [Provider Structure](#3-provider-structure)
4. [Shared Components Catalog](#4-shared-components-catalog)
5. [Page Layout Patterns](#5-page-layout-patterns)
6. [Creating New Components](#6-creating-new-components)

---

## 1. File Placement Rules

### 🔴 Where to Put What

When creating new files, follow these placement rules:

| Directory | What Goes Here | What Does NOT Go Here |
|-----------|----------------|----------------------|
| `src/app/` | Routes and page wiring only | Reusable components, utilities |
| `src/components/` | Shared, reusable UI components | Page-specific logic, API calls |
| `src/providers/` | React context providers | Components, utilities |
| `src/hooks/` | Custom React hooks | Components, providers |
| `src/theme/` | Theme definitions and providers | Components |
| `src/utils/` | Pure helper functions | React components, hooks |
| `src/types/` | TypeScript type definitions | Runtime code |
| `src/libs/` | External service integrations | UI components |
| `src/models/` | Database schemas (Drizzle) | UI components |

### Examples

```typescript
// ✅ CORRECT placements
src/app/[locale]/(unauth)/book/service/page.tsx  // Route page
src/components/ServiceCard.tsx                    // Reusable component
src/providers/SalonProvider.tsx                   // Context provider
src/hooks/useBooking.ts                           // Custom hook

// ❌ WRONG placements
src/app/[locale]/components/ServiceCard.tsx       // Don't nest components in app/
src/components/api/fetchServices.ts               // API logic doesn't go in components/
```

---

## 2. Component Hierarchy

### 1.1 Application Structure

```
RootLayout
├── SalonProvider (tenant context)
│   └── ThemeProvider (injects CSS vars)
│       └── LocaleLayout
│           └── Page Components
│               ├── PageLayout (container)
│               ├── MainCard (cards)
│               ├── Button variants
│               └── Feature components
```

### 2.2 Booking Flow Hierarchy

```
BookServicePage
├── Header (salon name, centered)
├── ProgressSteps (step 1)
├── SearchBar (custom)
├── CategoryTabs (custom)
├── ServiceGrid
│   └── ServiceCard[] (custom, multi-select)
├── MainCard (auth footer)
│   └── FormInput, PrimaryButton
├── BlockingLoginModal (conditional)
└── FixedBottomBar (when selection)

BookTechPage
├── Header (back + title)
├── ProgressSteps (step 2)
├── SummaryCard (accent gradient)
├── TechnicianGrid
│   └── TechnicianCard[] (custom, single-select)
└── AnyArtistOption

BookTimePage
├── Header (back + title)
├── ProgressSteps (step 3)
├── SummaryCard (with tech avatar)
├── CalendarCard
│   ├── MonthNavigation
│   └── DayGrid
└── TimeSlotSections
    ├── MorningSlots
    └── AfternoonSlots

BookConfirmPage
├── Animations (confetti, sparkles)
├── SuccessCheckmark (animated)
├── Title + Subtitle
├── AppointmentCard
│   ├── PurpleHeader (tech info)
│   ├── ServiceDetails
│   ├── DateTimeDetails
│   └── PointsTeaser
└── ActionButtons
    ├── PayNowButton
    ├── ViewChangeButton
    └── BackToProfileLink
```

---

## 3. Provider Structure

### 3.1 SalonProvider

**File:** `src/providers/SalonProvider.tsx`

**Purpose:** Provides tenant (salon) context to all components.

```typescript
interface SalonContextValue {
  salonName: string;
}

// Usage
const { salonName } = useSalon();
```

**Current Implementation:** Static default value, will be dynamic per subdomain.

**Future Enhancement:**
```typescript
interface SalonContextValue {
  salonId: string;
  salonName: string;
  salonSlug: string;
  settings: SalonSettings;
}
```

### 3.2 ThemeProvider

**File:** `src/theme/ThemeProvider.tsx`

**Purpose:** Manages theme state and injects CSS variables.

```typescript
interface ThemeContextValue {
  theme: Theme;        // Full theme object
  themeKey: string;    // Theme identifier
}

// Usage
const { theme, themeKey } = useTheme();
```

**Exports:**
- `ThemeProvider` - Context provider component
- `useTheme` - Hook to access theme context
- `themeVars` - CSS variable references for styling

### 3.3 Provider Hierarchy

```typescript
// src/app/[locale]/layout.tsx
export default function LocaleLayout({ children }) {
  return (
    <SalonProvider salonName="Nail Salon No.5">
      <ThemeProvider>
        {children}
      </ThemeProvider>
    </SalonProvider>
  );
}
```

---

## 4. Shared Components Catalog

### 4.1 Layout Components

#### PageLayout

**File:** `src/components/PageLayout.tsx`

**Purpose:** Page container with consistent max-width and padding.

```typescript
interface PageLayoutProps {
  children: React.ReactNode;
  className?: string;
}

// Usage
<PageLayout>
  {/* Page content */}
</PageLayout>
```

**Renders:**
```html
<div class="mx-auto max-w-[430px] w-full px-4 flex flex-col gap-4">
  {children}
</div>
```

#### MainCard

**File:** `src/components/MainCard.tsx`

**Purpose:** Primary card container with optional gold accent bar.

```typescript
interface MainCardProps {
  children: React.ReactNode;
  showGoldBar?: boolean;      // Display gold bar at top
  animateGoldBar?: boolean;   // Animate bar width on mount
  className?: string;
}

// Usage
<MainCard showGoldBar animateGoldBar>
  <SummaryRow label="Service" value="BIAB Short" />
</MainCard>
```

### 4.2 Button Components

#### Button (Unified)

**File:** `src/components/Button.tsx`

**Purpose:** Unified button with variant support.

```typescript
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  children: React.ReactNode;
  // ...extends ButtonHTMLAttributes
}

// Usage
<Button variant="primary" size="lg">
  Continue
</Button>
```

#### PrimaryButton

**File:** `src/components/PrimaryButton.tsx`

**Purpose:** Convenience wrapper for gold CTA buttons.

```typescript
// Usage
<PrimaryButton onClick={handleSubmit}>
  Book Now
</PrimaryButton>
```

**Note:** Wrapper around `<Button variant="primary" />`.

#### SecondaryButton

**File:** `src/components/SecondaryButton.tsx`

**Purpose:** Convenience wrapper for neutral buttons.

```typescript
// Usage
<SecondaryButton onClick={handleCancel}>
  Cancel
</SecondaryButton>
```

### 4.3 Data Display Components

#### SummaryRow

**File:** `src/components/SummaryRow.tsx`

**Purpose:** Label-value pair display (receipt style).

```typescript
interface SummaryRowProps {
  label: string;
  value: string | React.ReactNode;
  highlight?: boolean;  // Temporary highlight effect
}

// Usage
<SummaryRow label="Service" value="BIAB Short" />
<SummaryRow label="Total" value="$65" highlight />
```

#### SectionTitle

**File:** `src/components/SectionTitle.tsx`

**Purpose:** Section headers with optional icon.

```typescript
interface SectionTitleProps {
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

// Usage
<SectionTitle icon={<CalendarIcon />}>
  Choose Date
</SectionTitle>
```

#### PointsBadge

**File:** `src/components/PointsBadge.tsx`

**Purpose:** Display points/rewards value.

```typescript
interface PointsBadgeProps {
  points: number;
  size?: 'sm' | 'md';
}

// Usage
<PointsBadge points={65} />
```

### 4.4 Form Components

#### FormInput

**File:** `src/components/FormInput.tsx`

**Purpose:** Styled text input with theme-aware focus.

```typescript
interface FormInputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

// Usage
<FormInput
  type="tel"
  value={phone}
  onChange={(e) => setPhone(e.target.value)}
  placeholder="Phone number"
/>
```

### 4.5 Modal Components

#### BlockingLoginModal

**File:** `src/components/BlockingLoginModal.tsx`

**Purpose:** Authentication modal that blocks booking flow.

```typescript
interface BlockingLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: () => void;
}

// Usage
<BlockingLoginModal
  isOpen={isLoginModalOpen}
  onClose={() => setIsLoginModalOpen(false)}
  onLoginSuccess={handleLoginSuccess}
/>
```

### 4.6 Navigation Components

#### ProgressSteps

**File:** `src/components/ProgressSteps.tsx`

**Purpose:** Booking flow progress indicator.

```typescript
interface ProgressStepsProps {
  currentStep: number;  // 0-3
  steps?: string[];     // Default: ['Service', 'Artist', 'Time', 'Confirm']
}

// Usage
<ProgressSteps currentStep={1} />
```

---

## 5. Page Layout Patterns

### 🔴 Do Not Create Alternative Layouts

All pages MUST follow the established layout pattern below. Do not create alternative page shells, custom containers, or different layout structures unless explicitly instructed.

The standard layout includes:
- `min-h-screen` with theme gradient background
- `max-w-[430px]` centered container
- `px-4 pb-10` padding
- Staggered mount animations

### 5.1 Standard Page Structure

```typescript
export default function SomePage() {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div
      className="min-h-screen"
      style={{
        background: `linear-gradient(to bottom, 
          color-mix(in srgb, ${themeVars.background} 95%, white), 
          ${themeVars.background}, 
          color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4 pb-10">
        {/* Header */}
        <div style={{ opacity: mounted ? 1 : 0, transition: 'opacity 300ms' }}>
          {/* Navigation + Title */}
        </div>
        
        {/* Progress Steps */}
        <ProgressSteps currentStep={0} />
        
        {/* Main Content */}
        <MainCard>
          {/* ... */}
        </MainCard>
        
        {/* Footer */}
      </div>
    </div>
  );
}
```

### 5.2 With Fixed Bottom Bar

```typescript
return (
  <div className="min-h-screen" style={{ background: '...' }}>
    <div className="mx-auto max-w-[430px] px-4 pb-10">
      {/* Main content */}
      
      {/* Spacer for fixed bar */}
      {hasSelection && <div className="h-24" />}
    </div>
    
    {/* Fixed bottom bar */}
    {hasSelection && (
      <div className="fixed inset-x-0 bottom-0 z-50 bg-white shadow-lg">
        <div className="mx-auto max-w-[430px] p-4">
          {/* Bar content */}
        </div>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>
    )}
  </div>
);
```

### 5.3 Card Grid Pattern

```typescript
<div className="grid grid-cols-2 gap-3">
  {items.map((item, index) => (
    <div
      key={item.id}
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(15px)',
        transition: `opacity 300ms ease-out ${200 + index * 50}ms, 
                     transform 300ms ease-out ${200 + index * 50}ms`,
      }}
    >
      {/* Card content */}
    </div>
  ))}
</div>
```

---

## 6. Creating New Components

### 6.1 Component Checklist

Before creating a new component, verify:

- [ ] No existing component serves this purpose
- [ ] Uses `themeVars` for all colors
- [ ] Follows naming conventions (PascalCase)
- [ ] Includes TypeScript interface for props
- [ ] Includes JSDoc comments
- [ ] Supports animation patterns if interactive

### 6.2 Template

```typescript
import * as React from 'react';
import { themeVars } from '@/theme';
import { cn } from '@/utils/Helpers';

export interface NewComponentProps {
  children: React.ReactNode;
  variant?: 'default' | 'alt';
  className?: string;
}

/**
 * NewComponent - Brief description
 *
 * Detailed description of purpose and usage.
 */
export const NewComponent = React.forwardRef<
  HTMLDivElement,
  NewComponentProps
>(({ children, variant = 'default', className }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-2xl',
        variant === 'alt' && 'bg-neutral-50',
        className,
      )}
      style={{
        backgroundColor: themeVars.cardBackground,
        borderColor: themeVars.cardBorder,
        borderWidth: 1,
      }}
    >
      {children}
    </div>
  );
});

NewComponent.displayName = 'NewComponent';
```

### 6.3 Animation Pattern

For animated components:

```typescript
export function AnimatedCard({ children, delay = 0 }) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(10px)',
        transition: `opacity 300ms ease-out ${delay}ms, 
                     transform 300ms ease-out ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}
```

### 6.4 Selection Pattern

For selectable components:

```typescript
export function SelectableCard({ 
  isSelected, 
  onSelect, 
  children 
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="rounded-2xl text-left transition-all duration-200"
      style={{
        transform: isSelected ? 'scale(1.02)' : undefined,
        background: isSelected
          ? `linear-gradient(to bottom right, 
              color-mix(in srgb, ${themeVars.primary} 20%, transparent), 
              color-mix(in srgb, ${themeVars.primaryDark} 10%, transparent))`
          : 'white',
        outline: isSelected ? `2px solid ${themeVars.primary}` : undefined,
        borderWidth: isSelected ? 0 : 1,
        borderColor: isSelected ? 'transparent' : themeVars.cardBorder,
      }}
    >
      {children}
      
      {/* Selection indicator */}
      {isSelected && (
        <div
          className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full"
          style={{
            background: `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`,
          }}
        >
          <CheckIcon className="text-white" />
        </div>
      )}
    </button>
  );
}
```

---

## Related Documents

- [PRD](./PRD.md) - Product requirements
- [Technical Spec](./TECHNICAL_SPEC.md) - Architecture details
- [UI/UX Spec](./UI_UX_SPEC.md) - Design patterns
- [AI Rules](./AI_RULES.md) - Development constraints
- [Design System](../design-system.md) - Visual specifications

