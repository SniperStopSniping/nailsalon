---
name: Admin Dashboard UI/UX
overview: Complete UI/UX design specification for the Salon Admin Dashboard Home Screen featuring an iPhone-style widget zone and app grid layout with three distinct theme variants.
todos:
  - id: ios-widget
    content: Create IOSWidget component with glassmorphism blur effect
    status: completed
  - id: ios-app-icon
    content: Create IOSAppIcon with gradient backgrounds like iOS apps
    status: completed
  - id: ios-app-tile
    content: Create IOSAppTile with tap animation and proper styling
    status: completed
  - id: ios-badge
    content: Create IOSBadge notification component
    status: completed
  - id: admin-layout
    content: Create /admin layout with iOS-style header
    status: completed
  - id: admin-page
    content: Build admin dashboard page with widgets and app grid
    status: completed
  - id: redirect-page
    content: Create non-locale /admin redirect page
    status: completed
---

# Admin Dashboard - Revised Implementation Plan

## Key Corrections from Previous Attempt

| Issue | Fix |

|-------|-----|

| Wrong location (`/staff`) | New route: `/admin` (salon owner portal) |

| Generic/ugly styling | Authentic iOS aesthetic with proper depth, blur, shadows |

| Emojis as icons | SF Symbols-style SVG icons |

| Flat widgets | Layered depth with backdrop blur and proper shadows |

---

## Route Structure

```
/admin                    → Admin Dashboard Home (widgets + app grid)
/admin/appointments       → Appointment management
/admin/team               → Staff management  
/admin/clients            → Client database
/admin/analytics          → Revenue analytics
/admin/referrals          → Referral program
/admin/reviews            → Review management
/admin/marketing          → SMS campaigns
/admin/rewards            → Loyalty program
/admin/alerts             → System alerts
/admin/services           → Service & pricing
/admin/hours              → Business hours
/admin/settings           → Settings
```

---

## Visual Design: Apple Clean White (iOS-Inspired)

### Core Visual Properties

| Element | Specification |

|---------|---------------|

| Background | `#f2f2f7` (iOS system grouped background) |

| Widget Background | `rgba(255,255,255,0.8)` with `backdrop-filter: blur(20px)` |

| Widget Border | None - rely on shadow and blur |

| Widget Shadow | `0 2px 10px rgba(0,0,0,0.08)` |

| Widget Corner Radius | 16px (iOS standard) |

| Tile Background | `#ffffff` |

| Tile Shadow | `0 1px 3px rgba(0,0,0,0.08)` |

| Tile Corner Radius | 14px |

| Primary Color | `#007AFF` (iOS blue) |

| Typography | `-apple-system, SF Pro Display` |

### Widget Styling (iOS Widgets)

```
┌─────────────────────────────────────┐
│  TODAY'S REVENUE          ●        │ ← Small colored dot indicator
│                                     │
│  $2,847                            │ ← 34px, SF Pro Display, weight 700
│  12 completed · ↑18%               │ ← 13px, secondary label color
└─────────────────────────────────────┘
   ↑ backdrop-filter: blur(20px)
   ↑ background: rgba(255,255,255,0.72)
```

### App Tile Styling (iOS Home Screen)

```
┌───────────────┐
│   ┌─────┐     │
│   │ ◉   │     │ ← 60x60 icon with gradient background
│   └─────┘     │
│   Appts       │ ← 11px, medium weight
└───────────────┘
   ↑ No border, subtle shadow
   ↑ Icon has own rounded rect background (like iOS apps)
```

### Icon System

Use **Lucide React icons** styled like SF Symbols:

- 24px size inside 60x60 rounded rect
- Gradient backgrounds per icon category:
  - Blue: Calendar, Clock
  - Green: Revenue, Rewards  
  - Orange: Alerts, Reviews
  - Purple: Clients, Team
  - Pink: Marketing, Referrals

---

## Files to Create

| File | Purpose |

|------|---------|

| [`src/app/[locale]/(auth)/admin/page.tsx`](src/app/[locale]/(auth)/admin/page.tsx) | Dashboard home |

| [`src/app/[locale]/(auth)/admin/layout.tsx`](src/app/[locale]/(auth)/admin/layout.tsx) | Admin layout wrapper |

| [`src/app/(auth)/admin/page.tsx`](src/app/\\\\\\\\\\(auth)/admin/page.tsx) | Redirect to locale version |

| [`src/components/admin/IOSWidget.tsx`](src/components/admin/IOSWidget.tsx) | Glassmorphic widget |

| [`src/components/admin/IOSAppTile.tsx`](src/components/admin/IOSAppTile.tsx) | Home screen tile |

| [`src/components/admin/IOSBadge.tsx`](src/components/admin/IOSBadge.tsx) | Notification badge |

| [`src/components/admin/IOSAppIcon.tsx`](src/components/admin/IOSAppIcon.tsx) | Gradient icon backgrounds |

| [`src/components/admin/index.ts`](src/components/admin/index.ts) | Barrel exports |

---

## Implementation Approach

### Phase 1: Core Components

1. Create `IOSWidget` with glassmorphism (blur + transparency)
2. Create `IOSAppTile` with proper icon backgrounds and tap animation
3. Create `IOSAppIcon` with gradient backgrounds like real iOS apps
4. Create `IOSBadge` with iOS-style red notification bubble

### Phase 2: Dashboard Page

1. Create admin layout with iOS-style header
2. Build dashboard page with widget zone + app grid
3. Wire up mock data for demo
4. Add staggered entrance animations

### Phase 3: Theme Integration (Optional)

- Extend theme system for admin-specific tokens
- Keep Apple theme as default, allow switching

---

## Key Differences from Failed Attempt

| Before (Bad) | After (Good) |

|--------------|--------------|

| Flat white cards | Glassmorphic widgets with blur |

| Emoji icons | SVG icons with gradient backgrounds |

| Generic shadows | iOS-authentic shadow values |

| Wrong route | Dedicated `/admin` route |

| No visual hierarchy | Clear iOS-style hierarchy |

| Basic animations | Spring physics animations |