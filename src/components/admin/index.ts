/**
 * Admin Dashboard Components
 *
 * iOS-inspired components for the salon admin dashboard.
 * Features glassmorphism, gradient icons, spring animations,
 * and swipeable page navigation.
 */

// Legacy Widget components (kept for backward compatibility)
export {
  IOSAvailabilityBar,
  IOSStaffRow,
  IOSTimelineDots,
  IOSTrend,
  IOSWidget,
  type IOSWidgetProps,
} from './IOSWidget';

// Legacy App icon components
export {
  appIcons,
  type AppIconType,
  type IconGradient,
  iconGradients,
  IOSAppIcon,
  type IOSAppIconProps,
  IOSCustomIcon,
} from './IOSAppIcon';

// Legacy App tile components
export {
  IOSAppGrid,
  IOSAppTile,
  type IOSAppTileProps,
} from './IOSAppTile';

// Legacy Badge components
export {
  IOSBadge,
  type IOSBadgeProps,
  IOSInlineBadge,
} from './IOSBadge';

// New Swipeable Dashboard Components
export { AnalyticsWidgets } from './AnalyticsWidgets';
export { AppGrid, type AppId, APPS } from './AppGrid';
export { AppModal, BackButton, ModalHeader } from './AppModal';
export { AppointmentsModal } from './AppointmentsModal';
export { ClientsModal } from './ClientsModal';
export { MarketingModal } from './MarketingModal';
export { NotificationsModal } from './NotificationsModal';
export { QuickActionsWidget } from './QuickActionsWidget';
export { ReviewsModal } from './ReviewsModal';
export { RewardsModal } from './RewardsModal';
export { ServicesModal } from './ServicesModal';
export { ProfileCard, Row, SearchBar, Section, SettingsModal } from './SettingsModal';
export { SkeletonWidgets } from './SkeletonWidgets';
export { StaffModal } from './StaffModal';
export { StaffOpsModal } from './StaffOpsModal';
export { PageIndicator, SwipeablePages } from './SwipeablePages';
export { TimeOffRequestsInbox } from './TimeOffRequestsInbox';

// Chart Components
export {
  ActivityRing,
  ChartLabels,
  defaultServiceItems,
  NestedRings,
  RevenueChart,
  RingLegend,
  ServiceBars,
} from './charts';
