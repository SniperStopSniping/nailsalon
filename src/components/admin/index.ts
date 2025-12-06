/**
 * Admin Dashboard Components
 *
 * iOS-inspired components for the salon admin dashboard.
 * Features glassmorphism, gradient icons, spring animations,
 * and swipeable page navigation.
 */

// Legacy Widget components (kept for backward compatibility)
export {
  IOSWidget,
  IOSTrend,
  IOSTimelineDots,
  IOSAvailabilityBar,
  IOSStaffRow,
  type IOSWidgetProps,
} from './IOSWidget';

// Legacy App icon components
export {
  IOSAppIcon,
  IOSCustomIcon,
  iconGradients,
  appIcons,
  type IOSAppIconProps,
  type AppIconType,
  type IconGradient,
} from './IOSAppIcon';

// Legacy App tile components
export {
  IOSAppTile,
  IOSAppGrid,
  type IOSAppTileProps,
} from './IOSAppTile';

// Legacy Badge components
export {
  IOSBadge,
  IOSInlineBadge,
  type IOSBadgeProps,
} from './IOSBadge';

// New Swipeable Dashboard Components
export { SwipeablePages, PageIndicator } from './SwipeablePages';
export { AnalyticsWidgets } from './AnalyticsWidgets';
export { AppGrid, APPS, type AppId } from './AppGrid';
export { AppModal, ModalHeader, BackButton } from './AppModal';
export { AppointmentsModal } from './AppointmentsModal';
export { SettingsModal, Section, Row, ProfileCard, SearchBar } from './SettingsModal';
export { ClientsModal } from './ClientsModal';
export { StaffModal } from './StaffModal';
export { ServicesModal } from './ServicesModal';
export { MarketingModal } from './MarketingModal';
export { ReviewsModal } from './ReviewsModal';
export { RewardsModal } from './RewardsModal';
export { SkeletonWidgets } from './SkeletonWidgets';
export { QuickActionsWidget } from './QuickActionsWidget';
export { NotificationsModal } from './NotificationsModal';

// Chart Components
export {
  RevenueChart,
  ChartLabels,
  ActivityRing,
  NestedRings,
  RingLegend,
  ServiceBars,
  defaultServiceItems,
} from './charts';
