# Product Requirements Document (PRD)

## Nail Salon Booking Platform

**Version:** 1.0  
**Last Updated:** December 2024  
**Status:** Active Development

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [Target Users](#2-target-users)
3. [Multi-Tenancy Model](#3-multi-tenancy-model)
4. [Core Features](#4-core-features)
5. [Authentication](#5-authentication)
6. [User Roles & Permissions](#6-user-roles--permissions)
7. [Core User Flows](#7-core-user-flows)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [Future Roadmap](#9-future-roadmap)

---

## 1. Product Vision

### 1.1 Overview

A **multi-tenant SaaS platform** for nail salons that provides a premium, mobile-first booking experience. Each salon (tenant) operates under its own subdomain with fully customizable branding, theme colors, and service catalog.

### 1.2 Design Philosophy

- **Luxury Apple/Tesla-inspired aesthetic** - Clean, minimal, premium feel
- **Mobile-first responsive design** - Optimized for phone booking (max-width 430px cards)
- **Delightful micro-interactions** - Smooth animations, confetti celebrations, staggered reveals
- **Multi-tenant theming** - Each salon can have unique brand colors and identity

### 1.3 Business Model

Franchise-style SaaS where:
- Platform owner (Super Admin) manages the infrastructure and billing
- Independent nail salons subscribe as tenants
- Each salon gets their own branded booking experience
- Clients book directly with their preferred salon

---

## 2. Target Users

### 2.1 Super Admin (Platform Owner)

**Role:** Manages the entire platform infrastructure

**Responsibilities:**
- Onboard and manage salon tenants
- Configure global platform settings
- Monitor platform health and usage
- Handle billing and subscriptions for salons
- Access analytics across all tenants
- Manage feature flags and rollouts

### 2.2 Salon Owner / Manager

**Role:** Manages a single salon (or multiple locations under one brand)

**Responsibilities:**
- Configure salon branding (logo, colors, theme)
- Manage service catalog (create, update, delete services)
- Manage technician profiles and assignments
- Set business hours and policies
- View salon-level appointments and analytics
- Handle client communications

### 2.3 Nail Technician

**Role:** Staff member with their own profile and schedule

**Responsibilities:**
- View their assigned appointments
- Manage personal availability (future feature)
- Update their profile and specialties
- Optionally accept/decline bookings (future feature)

### 2.4 Client

**Role:** End user who books nail appointments

**Responsibilities:**
- Browse and select services
- Choose preferred technician
- Pick appointment date and time
- Confirm booking
- View appointment history (future feature)
- Participate in loyalty/rewards program (future feature)

---

## 3. Multi-Tenancy Model

### 3.1 Tenant Identification

**Primary Method:** Subdomain-based routing

```
Format: {salon-slug}.nailsaas.com

Examples:
- glow.nailsaas.com
- luxe-nails.nailsaas.com
- manhattan-spa.nailsaas.com
```

**Future Enhancement:** Custom domain mapping

```
Example: salon-name.com → maps to salon tenant
```

### 3.2 Tenant Resolution Flow

1. Request arrives at platform domain
2. Extract subdomain from host header
3. Lookup salon by slug in database
4. Load salon configuration (theme, settings, branding)
5. Inject theme into `ThemeProvider`
6. Set salon context in `SalonProvider`
7. Render tenant-specific experience

### 3.3 Tenant Isolation

- **Data isolation:** All queries scoped by `salonId`
- **Theme isolation:** Each salon's colors loaded independently
- **Asset isolation:** Salon-specific logos and images
- **Configuration isolation:** Business hours, policies per salon

### 3.4 Theme System

Each salon has a `themeKey` that references a theme in the registry:

```typescript
interface Theme {
  key: string;           // 'nail-salon-no5'
  name: string;          // 'Nail Salon No.5'
  colors: {
    primary: string;     // Main brand color (buttons, accents)
    primaryDark: string; // Darker variant (selection states)
    accent: string;      // Secondary brand color (titles)
    accentLight: string; // Light accent for gradients
    background: string;  // Page background
    cardBackground: string;
    // ... additional semantic color tokens
  }
}
```

Themes are applied via CSS variables injected at runtime:
- `--theme-primary`
- `--theme-accent`
- `--theme-background`
- etc.

---

## 4. Core Features

### 4.1 Booking Flow (MVP - Implemented)

The core client experience is a 4-step booking wizard:

| Step | Screen | Description |
|------|--------|-------------|
| 1 | Service Selection | Browse and select one or more services from categorized grid |
| 2 | Technician Selection | Choose preferred nail artist or "surprise me" |
| 3 | Time Selection | Pick date from calendar and available time slot |
| 4 | Confirmation | Review booking, see success animation with confetti |

**Key Features:**
- Multi-service selection (combine services in one booking)
- Category filtering (Hands, Feet, Combo)
- Search functionality
- Real-time price calculation
- Progress indicator showing current step
- Staggered page load animations
- Success celebration with confetti and sparkles

**On Successful Confirmation (MVP):**
- Appointment is persisted to the database
- Linked to `salonId`, `serviceId`, `technicianId`, and client (via phone)
- User sees confirmation screen with booking details
- Booking status set to `confirmed`

### 4.2 Admin: Service Catalog Management (MVP - Planned)

Salon owners can manage their service offerings:

**Service CRUD Operations:**
- **Create:** Add new services with name, description, price, duration, category
- **Read:** View all services in a sortable/filterable list
- **Update:** Edit service details, toggle active/inactive
- **Delete:** Remove services (soft delete recommended)

**Service Model:**
```typescript
interface Service {
  id: string;
  salonId: string;        // Tenant scope
  name: string;           // "BIAB Short"
  description?: string;   // Optional detailed description
  price: number;          // 65 (in dollars)
  durationMinutes: number; // 75
  category: 'hands' | 'feet' | 'combo';
  imageUrl?: string;      // Optional service image
  isActive: boolean;      // Show/hide from booking
  sortOrder?: number;     // Display order within category
  createdAt: Date;
  updatedAt: Date;
}
```

### 4.3 Phone-First Authentication

All users authenticate via SMS OTP:

1. User enters phone number
2. System sends 6-digit OTP via SMS
3. User enters code to verify
4. Session is established

**Key Behaviors:**
- Auto-advance when phone number is complete (10 digits)
- Auto-verify when code is complete (6 digits)
- "Change phone number" option to go back
- Same auth flow for clients, owners, and technicians

---

## 5. Authentication

### 5.1 Authentication Method

**Phone-first SMS OTP** is the only authentication method:

- No email/password
- No social login (Google, Apple) - future roadmap
- No guest booking - authentication required
- No third-party auth providers (e.g., Clerk)

### 5.2 Authentication Flow

```
┌─────────────────┐
│  Enter Phone    │
│  +1 (xxx) xxx-xxxx
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Send OTP via   │
│  SMS (Twilio)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Enter 6-digit  │
│  Verification   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Session        │
│  Established    │
└─────────────────┘
```

### 5.3 Session Management

- Sessions stored securely (implementation TBD)
- Session persists across page refreshes
- Logout clears session data
- Session timeout policy TBD

---

## 6. User Roles & Permissions

### 6.1 Role Hierarchy

```
Super Admin (Platform)
    └── Salon Owner/Manager (Tenant)
            └── Nail Technician (Staff)
            └── Client (Customer)
```

### 6.2 Permission Matrix

| Action | Super Admin | Salon Owner | Technician | Client |
|--------|:-----------:|:-----------:|:----------:|:------:|
| Manage all salons | ✓ | - | - | - |
| Create/delete salons | ✓ | - | - | - |
| View platform analytics | ✓ | - | - | - |
| Manage salon branding | ✓ | ✓ | - | - |
| Manage services | ✓ | ✓ | - | - |
| Manage technicians | ✓ | ✓ | - | - |
| View salon appointments | ✓ | ✓ | Own only | Own only |
| Book appointments | - | - | - | ✓ |
| View own profile | ✓ | ✓ | ✓ | ✓ |

---

## 7. Core User Flows

### 7.1 Client Booking Flow

```
[Service Page] → [Tech Page] → [Time Page] → [Confirm Page] → [Success]
      │              │              │              │
      ▼              ▼              ▼              ▼
  - Search       - View techs   - Calendar     - Summary
  - Categories   - See ratings  - Time slots   - Animation
  - Multi-select - Select one   - Morning/PM   - Confetti
  - Auth prompt  - "Any" option - Select slot  - Next steps
```

**Step 1: Service Selection**
- Display salon name from `SalonProvider`
- Show progress indicator (step 1 of 4)
- Search bar for filtering services
- Category tabs: Hands 💅, Feet 🦶, Combo ✨
- 2-column grid of service cards
- Multi-selection with checkmarks
- Running total in sticky footer
- Auth prompt if not logged in
- "Continue" navigates to tech selection

**Step 2: Technician Selection**
- Back button to return to services
- Progress indicator (step 2 of 4)
- Summary card showing selected services and price
- 2-column grid of technician cards
- Avatar, name, rating, specialties
- Single selection with checkmark
- "Surprise me" option for any available
- Auto-navigate to time selection on pick

**Step 3: Time Selection**
- Back button to return to tech
- Progress indicator (step 3 of 4)
- Summary card with service, tech, and duration
- Calendar month view
- Past dates disabled
- Today highlighted with accent color
- Selected date with primary gradient
- Time slots grouped: Morning 🌅, Afternoon ☀️
- Click slot navigates to confirm

**Step 4: Confirmation + Success**
- Large animated checkmark
- Confetti burst animation
- Sparkle effects
- "You're All Set!" title with emoji bounce
- Appointment card with:
  - Tech avatar and name
  - Service details
  - Date and time
  - Total price
  - Points earned
- "Pay Now" button (future)
- "View or Change Appointment" button
- "Back to Profile" link

### 7.2 Blocking Login Modal

If user tries to proceed without authentication:

1. Modal appears with phone input
2. User enters phone number
3. Code is sent and verification input appears
4. On success, modal closes and flow continues
5. Cancel option to close modal

---

## 8. Non-Functional Requirements

### 8.1 Performance

- First Contentful Paint (FCP) < 1.5s
- Time to Interactive (TTI) < 3s
- Smooth 60fps animations
- Optimized images via Next.js Image component

### 8.2 Accessibility

- Semantic HTML structure
- ARIA labels on interactive elements
- Keyboard navigation support
- Sufficient color contrast
- Screen reader compatibility

### 8.3 Responsiveness

- Mobile-first design (primary target)
- Max content width: 430px (phone form factor)
- Tablet/desktop: centered layout
- Touch-friendly tap targets (min 44px)

### 8.4 Browser Support

- Chrome (latest 2 versions)
- Safari (latest 2 versions)
- Firefox (latest 2 versions)
- Edge (latest 2 versions)
- iOS Safari
- Android Chrome

---

## 9. Future Roadmap

The following features are **NOT in current scope** but planned for future releases:

### 9.1 Client Features

| Feature | Description | Priority |
|---------|-------------|----------|
| **Rewards/Loyalty** | Points system, redeem for discounts | High |
| **Referral Program** | Invite friends, earn bonuses | High |
| **Client Profile** | View/edit personal info | Medium |
| **Appointment History** | Past bookings list | Medium |
| **Gallery/Portfolio** | Browse nail art examples | Low |
| **Favorites** | Save preferred techs/services | Low |
| **SMS Notifications** | Booking confirmation, 24h reminder, 3h reminder, follow-ups | High |

### 9.2 Admin Features

| Feature | Description | Priority |
|---------|-------------|----------|
| **Appointment Management** | View/edit/cancel bookings | High |
| **Staff Management** | Add/edit technicians | High |
| **Schedule Management** | Set availability, block times | High |
| **Tech SMS Notifications** | SMS to technician on new/changed/cancelled bookings | High |
| **Branding Settings** | Upload logo, choose theme | Medium |
| **Business Hours** | Set open/close times | Medium |
| **Policy Settings** | Cancellation, no-show rules | Medium |
| **Client CRM** | Client list, notes, history | Low |
| **Analytics Dashboard** | Revenue, bookings, trends | Low |
| **Gallery Management** | Upload portfolio images | Low |

### 9.3 Payments

| Feature | Description | Priority |
|---------|-------------|----------|
| **Stripe Integration** | In-app payments | High |
| **Deposits** | Require deposit on booking | Medium |
| **Tips** | Add tip during checkout | Medium |
| **Refunds** | Process refunds for cancellations | Medium |

### 9.4 Advanced Features

| Feature | Description | Priority |
|---------|-------------|----------|
| **Email/Password Auth** | Alternative login method | Low |
| **Social Login** | Google, Apple sign-in | Low |
| **Custom Domains** | salon.com instead of subdomain | Medium |
| **Receptionist Role** | Limited booking-only access | Low |
| **Multi-location** | Manage multiple salon locations | Medium |
| **Waitlist** | Join waitlist for busy times | Low |

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| **Tenant** | A single salon/business using the platform |
| **Slug** | URL-friendly identifier (e.g., "glow-nails") |
| **Theme** | Collection of brand colors for a tenant |
| **BIAB** | Builder In A Bottle - nail service type |
| **Gel-X** | Press-on extension nail system |
| **Tech/Artist** | Nail technician who performs services |
| **OTP** | One-Time Password (SMS verification code) |

---

## Appendix B: Related Documents

- [Technical Specification](./TECHNICAL_SPEC.md) - Architecture, data models, APIs
- [UI/UX Specification](./UI_UX_SPEC.md) - Design system, user flows
- [AI Behavioral Rules](./AI_RULES.md) - Cursor/AI coding constraints
- [Design System](../design-system.md) - Typography, colors, spacing

