# Technical Specification

## Nail Salon Booking Platform

**Version:** 1.0  
**Last Updated:** December 2024  
**Status:** Active Development

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Multi-Tenant Architecture](#4-multi-tenant-architecture)
5. [Theme System](#5-theme-system)
6. [Data Models](#6-data-models)
7. [Authentication Flow](#7-authentication-flow)
8. [API Structure](#8-api-structure)
9. [State Management](#9-state-management)
10. [Future Technical Roadmap](#10-future-technical-roadmap)

---

## 1. Architecture Overview

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Browser                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Next.js Frontend                      │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐   │   │
│  │  │ Service │ │  Tech   │ │  Time   │ │   Confirm   │   │   │
│  │  │  Page   │ │  Page   │ │  Page   │ │    Page     │   │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────────┘   │   │
│  │                         │                                │   │
│  │  ┌─────────────────────┴─────────────────────────────┐  │   │
│  │  │              Providers & Context                   │  │   │
│  │  │  ┌──────────────┐  ┌──────────────┐               │  │   │
│  │  │  │SalonProvider │  │ThemeProvider │               │  │   │
│  │  │  └──────────────┘  └──────────────┘               │  │   │
│  │  └───────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Next.js API Routes                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │ /salons  │ │/services │ │  /techs  │ │  /appointments   │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Drizzle ORM Layer                           │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                        PostgreSQL                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │  salons  │ │ services │ │  techs   │ │   appointments   │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Request Flow

```
1. Request: glow.nailsaas.com/book/service
2. Middleware: Extract subdomain "glow"
3. Layout: Load salon by slug, wrap in providers
4. Page: Render with salon context and theme
5. User Action: Select service, trigger navigation
6. API (future): Create appointment via /api/appointments
```

---

## 2. Tech Stack

### 2.1 Core Technologies

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| **Framework** | Next.js | 14.x | React framework with App Router |
| **Language** | TypeScript | 5.x | Type-safe JavaScript |
| **Styling** | Tailwind CSS | 3.x | Utility-first CSS |
| **Database** | PostgreSQL | 15+ | Relational database |
| **ORM** | Drizzle ORM | 0.35+ | Type-safe database queries |
| **Animation** | Framer Motion | 12.x | Smooth animations |
| **Auth** | Custom SMS OTP | - | Phone-based authentication |

### 2.2 Key Dependencies

```json
{
  "dependencies": {
    "next": "^14.2.25",
    "react": "^18.3.1",
    "tailwindcss": "^3.4.14",
    "drizzle-orm": "^0.35.1",
    "framer-motion": "^12.23.24",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.4",
    "zod": "^3.23.8"
  }
}
```

### 2.3 Development Tools

| Tool | Purpose |
|------|---------|
| ESLint | Code linting |
| Prettier | Code formatting |
| Vitest | Unit testing |
| Playwright | E2E testing |
| Storybook | Component documentation |
| Husky | Git hooks |
| Commitlint | Commit message linting |

---

## 3. Project Structure

```
src/
├── app/                      # Next.js App Router
│   ├── [locale]/            # Internationalized routes
│   │   ├── (auth)/          # Authenticated routes
│   │   │   └── dashboard/   # Admin dashboard
│   │   └── (unauth)/        # Public routes
│   │       ├── book/        # Booking flow
│   │       │   ├── service/ # Step 1: Service selection
│   │       │   ├── tech/    # Step 2: Technician selection
│   │       │   ├── time/    # Step 3: Time selection
│   │       │   └── confirm/ # Step 4: Confirmation
│   │       ├── profile/     # Client profile (future)
│   │       ├── rewards/     # Rewards page (future)
│   │       └── gallery/     # Gallery page (future)
│   ├── api/                 # API routes (future)
│   ├── global-error.tsx     # Global error boundary
│   ├── robots.ts            # SEO robots.txt
│   └── sitemap.ts           # SEO sitemap
│
├── components/              # Reusable UI components
│   ├── Button.tsx           # Unified button component
│   ├── MainCard.tsx         # Primary card container
│   ├── FormInput.tsx        # Form input component
│   ├── PrimaryButton.tsx    # Gold button (wrapper)
│   ├── SecondaryButton.tsx  # Neutral button (wrapper)
│   ├── SummaryRow.tsx       # Label-value display
│   ├── SectionTitle.tsx     # Section headers
│   ├── PointsBadge.tsx      # Points display badge
│   ├── PageLayout.tsx       # Page container
│   ├── ProgressSteps.tsx    # Booking progress indicator
│   ├── BlockingLoginModal.tsx # Auth modal
│   └── ui/                  # shadcn/ui components
│
├── providers/               # React context providers
│   └── SalonProvider.tsx    # Salon/tenant context
│
├── theme/                   # Theme system
│   ├── index.ts             # Theme exports
│   ├── theme.types.ts       # TypeScript types
│   ├── themes.ts            # Theme definitions
│   └── ThemeProvider.tsx    # Theme context + CSS vars
│
├── models/                  # Database schema
│   └── Schema.ts            # Drizzle schema definitions
│
├── libs/                    # Utility libraries
│   ├── DB.ts                # Database connection
│   ├── Env.ts               # Environment variables
│   ├── i18n.ts              # Internationalization
│   └── Logger.ts            # Logging utility
│
├── hooks/                   # Custom React hooks
│   └── UseMenu.ts           # Menu state hook
│
├── utils/                   # Helper functions
│   ├── AppConfig.ts         # App configuration
│   └── Helpers.ts           # Utility functions (cn, etc.)
│
├── styles/                  # Global styles
│   └── global.css           # Tailwind imports + global CSS
│
└── types/                   # TypeScript types
    ├── Auth.ts              # Auth-related types
    ├── Enum.ts              # Enumerations
    └── Subscription.ts      # Subscription types
```

---

## 4. Multi-Tenant Architecture

### 4.1 Tenant Resolution

**Current Implementation:** SalonProvider with default salon name

```typescript
// src/providers/SalonProvider.tsx
interface SalonContextValue {
  salonName: string;
}

const DEFAULT_SALON_NAME = 'Nail Salon No.5';

export function SalonProvider({ children, salonName }: SalonProviderProps) {
  const value = useMemo(() => ({
    salonName: salonName || DEFAULT_SALON_NAME,
  }), [salonName]);

  return (
    <SalonContext.Provider value={value}>
      {children}
    </SalonContext.Provider>
  );
}
```

**Future Implementation:** Subdomain-based resolution

```typescript
// middleware.ts (future)
export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const subdomain = host.split('.')[0];
  
  // Skip for main domain
  if (subdomain === 'www' || subdomain === 'nailsaas') {
    return NextResponse.next();
  }
  
  // Add salon slug to headers for downstream use
  const response = NextResponse.next();
  response.headers.set('x-salon-slug', subdomain);
  return response;
}
```

### 4.2 Data Isolation

All database queries MUST be scoped by `salonId`:

```typescript
// ❌ WRONG - No tenant scoping
const services = await db.select().from(servicesTable);

// ✅ CORRECT - Scoped to current salon
const services = await db
  .select()
  .from(servicesTable)
  .where(eq(servicesTable.salonId, currentSalonId));
```

### 4.3 Theme Isolation

Each salon's theme is loaded at request time:

```typescript
// Layout.tsx (future)
export default async function Layout({ children, params }) {
  const salon = await getSalonBySlug(params.salonSlug);
  
  return (
    <SalonProvider salonName={salon.name}>
      <ThemeProvider themeKey={salon.themeKey}>
        {children}
      </ThemeProvider>
    </SalonProvider>
  );
}
```

---

## 5. Theme System

### 5.1 Architecture

```
ThemeProvider (injects CSS vars)
       │
       ▼
  ┌─────────────────────────────────────┐
  │     CSS Variables (document root)    │
  │  --theme-primary: #f4b864           │
  │  --theme-accent: #7b4ea3            │
  │  --theme-background: #f6ebdd        │
  │  ... etc                            │
  └─────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────┐
  │          themeVars object           │
  │  primary: 'var(--theme-primary)'    │
  │  accent: 'var(--theme-accent)'      │
  │  ... etc                            │
  └─────────────────────────────────────┘
       │
       ▼
  ┌─────────────────────────────────────┐
  │           Component Usage           │
  │  style={{ color: themeVars.accent }}│
  │  className="bg-[var(--theme-primary)]"
  └─────────────────────────────────────┘
```

### 5.2 Theme Type Definition

```typescript
// src/theme/theme.types.ts
export interface ThemeColors {
  // Brand colors
  primary: string;           // #f4b864 - Main gold
  primaryDark: string;       // #d6a249 - Dark gold
  accent: string;            // #7b4ea3 - Purple titles
  accentLight: string;       // #9b6dc6 - Light purple

  // Backgrounds
  background: string;        // #f6ebdd - Page background
  cardBackground: string;    // #ffffff - Card bg
  surfaceAlt: string;        // #fff7ec - Alt surface
  selectedBackground: string;// #f5e6d3 - Selected state
  accentSelected: string;    // #e9d5f5 - Purple selected
  inputBackground: string;   // neutral-50
  highlightBackground: string;// #fef9e7 - Points highlight

  // Borders
  cardBorder: string;        // #e6d6c2 - Card borders
  borderMuted: string;       // #d9c6aa - Muted borders
  selectedRing: string;      // #d6a249 - Selection ring

  // Text
  titleText: string;         // #7b4ea3 - Page titles
}

export interface Theme {
  key: string;
  name: string;
  colors: ThemeColors;
}
```

### 5.3 Theme Registry

```typescript
// src/theme/themes.ts
export const nailSalonNo5Theme: Theme = {
  key: 'nail-salon-no5',
  name: 'Nail Salon No.5',
  colors: {
    primary: '#f4b864',
    primaryDark: '#d6a249',
    accent: '#7b4ea3',
    // ... all color tokens
  },
};

export const themes: ThemeRegistry = {
  'nail-salon-no5': nailSalonNo5Theme,
  // Future themes added here
};

export function getTheme(themeKey?: string | null): Theme {
  return themes[themeKey ?? ''] ?? themes[defaultThemeKey]!;
}
```

### 5.4 Using Theme in Components

```typescript
import { themeVars } from '@/theme';

// Method 1: Inline styles (recommended for dynamic values)
<div style={{ 
  backgroundColor: themeVars.primary,
  color: themeVars.titleText 
}}>

// Method 2: Tailwind arbitrary values
<div className="bg-[var(--theme-primary)] text-[var(--theme-title-text)]">

// Method 3: useTheme hook (for accessing full theme object)
const { theme, themeKey } = useTheme();
console.log(theme.colors.primary); // "#f4b864"
```

### 5.5 Theme Color Reference

| Token | CSS Variable | Default Value | Usage |
|-------|-------------|---------------|-------|
| `primary` | `--theme-primary` | `#f4b864` | Buttons, accents |
| `primaryDark` | `--theme-primary-dark` | `#d6a249` | Selection rings, gradients |
| `accent` | `--theme-accent` | `#7b4ea3` | Page titles, secondary actions |
| `background` | `--theme-background` | `#f6ebdd` | Page background |
| `cardBackground` | `--theme-card-background` | `#ffffff` | Card backgrounds |
| `cardBorder` | `--theme-card-border` | `#e6d6c2` | Card borders |
| `titleText` | `--theme-title-text` | `#7b4ea3` | Page titles |

---

## 6. Data Models

### 6.1 Salon (Tenant)

The core tenant entity representing a nail salon business.

```typescript
// Schema definition (Drizzle)
export const salonSchema = pgTable('salon', {
  id: text('id').primaryKey(),
  
  // Identity
  name: text('name').notNull(),                    // "Glow Nails"
  slug: text('slug').notNull().unique(),           // "glow-nails"
  customDomain: text('custom_domain'),             // "glownails.com"
  
  // Branding
  themeKey: text('theme_key').default('nail-salon-no5'),
  logoUrl: text('logo_url'),
  coverImageUrl: text('cover_image_url'),
  
  // Contact
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zipCode: text('zip_code'),
  
  // Social Links (JSON)
  socialLinks: jsonb('social_links').$type<{
    instagram?: string;
    facebook?: string;
    tiktok?: string;
  }>(),
  
  // Business Hours (JSON)
  businessHours: jsonb('business_hours').$type<{
    monday: { open: string; close: string } | null;
    tuesday: { open: string; close: string } | null;
    // ... etc
  }>(),
  
  // Policies (JSON)
  policies: jsonb('policies').$type<{
    cancellationHours: number;
    noShowFee: number;
    depositRequired: boolean;
    depositAmount: number;
  }>(),
  
  // Stripe Integration
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripeSubscriptionStatus: text('stripe_subscription_status'),
  
  // Metadata
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

// TypeScript type
export type Salon = typeof salonSchema.$inferSelect;
export type NewSalon = typeof salonSchema.$inferInsert;
```

### 6.2 Service

Services offered by a salon (scoped to tenant).

```typescript
export const serviceSchema = pgTable('service', {
  id: text('id').primaryKey(),
  salonId: text('salon_id').notNull().references(() => salonSchema.id),
  
  // Service Details
  name: text('name').notNull(),              // "BIAB Short"
  description: text('description'),           // "Builder gel for natural..."
  price: integer('price').notNull(),          // 6500 (cents) or 65 (dollars)
  durationMinutes: integer('duration_minutes').notNull(), // 75
  
  // Categorization
  category: text('category').notNull(),       // 'hands' | 'feet' | 'combo'
  
  // Display
  imageUrl: text('image_url'),
  sortOrder: integer('sort_order').default(0),
  
  // Status
  isActive: boolean('is_active').default(true),
  
  // Metadata
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => ({
  salonIdx: index('service_salon_idx').on(table.salonId),
  categoryIdx: index('service_category_idx').on(table.salonId, table.category),
}));

export type Service = typeof serviceSchema.$inferSelect;
export type NewService = typeof serviceSchema.$inferInsert;

// Service categories
export const SERVICE_CATEGORIES = ['hands', 'feet', 'combo'] as const;
export type ServiceCategory = typeof SERVICE_CATEGORIES[number];
```

### 6.3 Technician

Nail technicians/artists who perform services.

```typescript
export const technicianSchema = pgTable('technician', {
  id: text('id').primaryKey(),
  salonId: text('salon_id').notNull().references(() => salonSchema.id),
  
  // Profile
  name: text('name').notNull(),               // "Daniela"
  bio: text('bio'),                           // "5 years experience..."
  avatarUrl: text('avatar_url'),
  
  // Professional
  specialties: jsonb('specialties').$type<string[]>(), // ["BIAB", "Gel-X"]
  rating: numeric('rating', { precision: 2, scale: 1 }), // 4.8
  reviewCount: integer('review_count').default(0),
  
  // Availability (basic model)
  workDays: jsonb('work_days').$type<number[]>(), // [1, 2, 3, 4, 5] = Mon-Fri
  startTime: text('start_time'),              // "09:00"
  endTime: text('end_time'),                  // "18:00"
  
  // Status
  isActive: boolean('is_active').default(true),
  
  // Metadata
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => ({
  salonIdx: index('technician_salon_idx').on(table.salonId),
}));

// Many-to-many: Technician <-> Services
export const technicianServicesSchema = pgTable('technician_services', {
  technicianId: text('technician_id').notNull().references(() => technicianSchema.id),
  serviceId: text('service_id').notNull().references(() => serviceSchema.id),
}, (table) => ({
  pk: primaryKey({ columns: [table.technicianId, table.serviceId] }),
}));

export type Technician = typeof technicianSchema.$inferSelect;
export type NewTechnician = typeof technicianSchema.$inferInsert;
```

### 6.4 Appointment

Booked appointments linking clients and technicians. Supports **multi-service bookings** via the `appointment_services` junction table.

```typescript
export const appointmentSchema = pgTable('appointment', {
  id: text('id').primaryKey(),
  salonId: text('salon_id').notNull().references(() => salonSchema.id),
  
  // Technician (services are linked via junction table)
  technicianId: text('technician_id').references(() => technicianSchema.id),
  
  // Client (phone-based identification)
  clientPhone: text('client_phone').notNull(),
  clientName: text('client_name'),
  
  // Timing
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  
  // Status
  status: text('status').notNull().default('confirmed'),
  // 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'
  
  // Totals (computed from linked services at booking time)
  totalPrice: integer('total_price').notNull(),           // Sum of all service prices
  totalDurationMinutes: integer('total_duration_minutes').notNull(), // Sum of durations
  
  // Additional
  notes: text('notes'),
  
  // Metadata
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => ({
  salonIdx: index('appointment_salon_idx').on(table.salonId),
  clientIdx: index('appointment_client_idx').on(table.clientPhone),
  dateIdx: index('appointment_date_idx').on(table.salonId, table.startTime),
  statusIdx: index('appointment_status_idx').on(table.salonId, table.status),
}));

export type Appointment = typeof appointmentSchema.$inferSelect;
export type NewAppointment = typeof appointmentSchema.$inferInsert;

// Appointment statuses
export const APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'cancelled',
  'completed',
  'no_show',
] as const;
export type AppointmentStatus = typeof APPOINTMENT_STATUSES[number];
```

### 6.5 Appointment Services (Junction Table)

Links appointments to their selected services. Supports **multi-service bookings** where a client books multiple services in one appointment (e.g., "BIAB Short + Gel Pedicure").

```typescript
export const appointmentServicesSchema = pgTable('appointment_services', {
  id: text('id').primaryKey(),
  appointmentId: text('appointment_id').notNull().references(() => appointmentSchema.id, { onDelete: 'cascade' }),
  serviceId: text('service_id').notNull().references(() => serviceSchema.id),
  
  // Price snapshot at booking time (in case service price changes later)
  priceAtBooking: integer('price_at_booking').notNull(),
  
  // Duration snapshot (in case service duration changes later)
  durationAtBooking: integer('duration_at_booking').notNull(),
  
}, (table) => ({
  appointmentIdx: index('appt_services_appointment_idx').on(table.appointmentId),
  serviceIdx: index('appt_services_service_idx').on(table.serviceId),
  // Prevent duplicate service in same appointment
  uniqueApptService: uniqueIndex('unique_appt_service').on(table.appointmentId, table.serviceId),
}));

export type AppointmentService = typeof appointmentServicesSchema.$inferSelect;
export type NewAppointmentService = typeof appointmentServicesSchema.$inferInsert;
```

**Usage Example:**
```typescript
// Client books BIAB Short ($65) + Gel Pedicure ($70)
// Creates 1 appointment + 2 appointment_services records

const appointment = {
  id: 'appt_123',
  salonId: 'salon_abc',
  technicianId: 'tech_daniela',
  clientPhone: '5551234567',
  startTime: new Date('2024-12-15T10:00:00'),
  endTime: new Date('2024-12-15T12:30:00'),  // 150 min total
  totalPrice: 135,  // $65 + $70
  totalDurationMinutes: 150,  // 75 + 75
  status: 'confirmed',
};

const appointmentServices = [
  { appointmentId: 'appt_123', serviceId: 'biab-short', priceAtBooking: 65, durationAtBooking: 75 },
  { appointmentId: 'appt_123', serviceId: 'gel-pedi', priceAtBooking: 70, durationAtBooking: 75 },
];
```

### 6.6 Entity Relationship Diagram (Updated for Multi-Service)

```
┌─────────────────────────────────────────────────────────────┐
│                         Salon (tenant)                       │
└──────────────────────────────┬──────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
   ┌───────────┐        ┌────────────┐        ┌─────────────┐
   │  Service  │        │ Technician │        │ Appointment │
   └─────┬─────┘        └──────┬─────┘        └──────┬──────┘
         │                     │                     │
         │                     │                     │
         ▼                     │                     ▼
   ┌───────────────────┐       │         ┌─────────────────────┐
   │ TechnicianServices│◄──────┘         │ AppointmentServices │
   │   (join table)    │                 │    (join table)     │
   └───────────────────┘                 └──────────┬──────────┘
                                                    │
                                                    ▼
                                              ┌───────────┐
                                              │  Service  │
                                              └───────────┘

  Relationships:
  - Salon 1:N Service, Technician, Appointment
  - Technician N:M Service (via TechnicianServices)
  - Appointment N:M Service (via AppointmentServices) ← MULTI-SERVICE SUPPORT
  - Appointment N:1 Technician
  - Appointment identified by clientPhone
```

---

## 7. Authentication Flow

### 7.1 Phone-First SMS OTP

```
┌─────────────────────────────────────────────────────────────┐
│                     Authentication Flow                      │
└─────────────────────────────────────────────────────────────┘

User                    Frontend                 Backend (future)
 │                         │                          │
 │  Enter phone number     │                          │
 │ ───────────────────────>│                          │
 │                         │                          │
 │                         │  POST /api/auth/send-otp │
 │                         │ ─────────────────────────>
 │                         │                          │
 │                         │          { success }     │
 │                         │ <─────────────────────────
 │                         │                          │
 │                         │  [Twilio sends SMS]      │
 │                         │                          │
 │  Enter 6-digit code     │                          │
 │ ───────────────────────>│                          │
 │                         │                          │
 │                         │ POST /api/auth/verify-otp│
 │                         │ ─────────────────────────>
 │                         │                          │
 │                         │   { token, user }        │
 │                         │ <─────────────────────────
 │                         │                          │
 │  Authenticated ✓        │  Store session           │
 │ <───────────────────────│                          │
```

### 7.2 Current Implementation (Frontend Mock)

```typescript
// src/app/[locale]/(unauth)/book/service/page.tsx
type AuthState = 'loggedOut' | 'verify' | 'loggedIn';

const [authState, setAuthState] = useState<AuthState>('loggedOut');
const [phone, setPhone] = useState('');
const [code, setCode] = useState('');

// Auto-advance when phone complete
useEffect(() => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    setAuthState('verify');
  }
}, [phone]);

// Auto-verify when code complete
useEffect(() => {
  if (code.length === 6) {
    setAuthState('loggedIn');
  }
}, [code]);
```

### 7.3 Future Implementation

```typescript
// /api/auth/send-otp/route.ts
export async function POST(request: Request) {
  const { phone } = await request.json();
  
  // Validate phone format
  const phoneSchema = z.string().regex(/^\d{10}$/);
  const parsed = phoneSchema.safeParse(phone);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid phone' }, { status: 400 });
  }
  
  // Generate OTP
  const otp = generateSecureOTP(6);
  
  // Store OTP with expiration (5 minutes)
  await storeOTP(phone, otp, 5 * 60);
  
  // Send via Twilio
  await twilioClient.messages.create({
    to: `+1${phone}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    body: `Your verification code is: ${otp}`,
  });
  
  return Response.json({ success: true });
}

// /api/auth/verify-otp/route.ts
export async function POST(request: Request) {
  const { phone, code } = await request.json();
  
  // Verify OTP
  const isValid = await verifyOTP(phone, code);
  if (!isValid) {
    return Response.json({ error: 'Invalid code' }, { status: 401 });
  }
  
  // Create or get user by phone
  const user = await getOrCreateUser(phone);
  
  // Create session
  const token = await createSession(user.id);
  
  return Response.json({ token, user });
}
```

---

## 8. API Structure

### 8.1 API Routes (Planned)

```
/api
├── auth/
│   ├── send-otp          POST   Send OTP to phone
│   ├── verify-otp        POST   Verify OTP and create session
│   └── logout            POST   End session
│
├── salons/
│   ├── [slug]            GET    Get salon by slug (public)
│   └── current           GET    Get current tenant (from context)
│
├── services/
│   ├── /                 GET    List services (public, scoped to salon)
│   ├── /                 POST   Create service (admin)
│   ├── [id]              GET    Get service by ID
│   ├── [id]              PUT    Update service (admin)
│   └── [id]              DELETE Delete service (admin)
│
├── technicians/
│   ├── /                 GET    List technicians (public)
│   ├── /                 POST   Create technician (admin)
│   ├── [id]              GET    Get technician by ID
│   ├── [id]              PUT    Update technician (admin)
│   └── [id]/availability GET    Get availability for date range
│
└── appointments/
    ├── /                 GET    List appointments (filtered by role)
    ├── /                 POST   Create appointment
    ├── [id]              GET    Get appointment by ID
    ├── [id]              PUT    Update appointment
    └── [id]/cancel       POST   Cancel appointment
```

### 8.2 Request/Response Patterns

**Standard Success Response:**
```json
{
  "data": { ... },
  "meta": {
    "timestamp": "2024-12-01T12:00:00Z"
  }
}
```

**Standard Error Response:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid phone number format",
    "details": { ... }
  }
}
```

**Paginated Response:**
```json
{
  "data": [ ... ],
  "meta": {
    "total": 50,
    "page": 1,
    "pageSize": 10,
    "totalPages": 5
  }
}
```

---

## 9. State Management

### 9.1 Server State

Currently, data is hardcoded in page components. Future implementation will use server components and data fetching:

```typescript
// Future: Server component with data fetching
export default async function BookServicePage({ params }) {
  const salon = await getSalon(params.salonSlug);
  const services = await getServices(salon.id);
  
  return <ServiceGrid services={services} />;
}
```

### 9.2 Client State

**URL-based state** for booking flow:

```typescript
// Booking state passed via URL params
/book/tech?serviceIds=biab-short,biab-medium
/book/time?serviceIds=biab-short,biab-medium&techId=daniela
/book/confirm?serviceIds=biab-short,biab-medium&techId=daniela&date=2024-12-15&time=10:00
```

**React state** for UI interactions:

```typescript
const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
const [authState, setAuthState] = useState<AuthState>('loggedOut');
const [mounted, setMounted] = useState(false); // For animations
```

### 9.3 Context Providers

```typescript
// Provider hierarchy
<SalonProvider salonName={salon.name}>
  <ThemeProvider themeKey={salon.themeKey}>
    {children}
  </ThemeProvider>
</SalonProvider>
```

---

## 10. Future Technical Roadmap

### 10.1 Database Migrations

- Implement full Drizzle schema for all entities
- Add migration scripts
- Set up seed data for development

### 10.2 API Implementation

- Implement all planned API routes
- Add input validation with Zod
- Add rate limiting
- Add request logging

### 10.3 Authentication

- Integrate Twilio for SMS OTP
- Implement secure session management
- Add token refresh mechanism
- Add logout functionality

### 10.4 Payments

- Stripe integration for salon subscriptions
- Client payment processing
- Deposit handling
- Refund processing

### 10.5 Real-time Features

- Appointment reminders (SMS)
- Real-time availability updates
- Push notifications

### 10.6 Performance

- Implement caching strategy
- Optimize database queries
- Add CDN for static assets
- Implement ISR for public pages

---

## Appendix: Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/db

# Authentication (future)
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...

# Payments (future)
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...

# Analytics (optional)
SENTRY_DSN=...
```

---

## Related Documents

- [PRD](./PRD.md) - Product requirements
- [UI/UX Spec](./UI_UX_SPEC.md) - Design system reference
- [AI Rules](./AI_RULES.md) - Development constraints
- [Design System](../design-system.md) - Visual guidelines

