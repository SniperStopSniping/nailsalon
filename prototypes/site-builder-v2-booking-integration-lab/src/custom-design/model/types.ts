import type {
  CUSTOM_DESIGN_DISPLAY_MODES,
  CUSTOM_DESIGN_GAPS,
  CUSTOM_DESIGN_SETTINGS_VERSION,
  CUSTOM_DESIGN_SUPPORTED_MIME_TYPES,
} from './constants';

export type CustomDesignMimeType =
  (typeof CUSTOM_DESIGN_SUPPORTED_MIME_TYPES)[number];
export type CustomDesignDisplayMode =
  (typeof CUSTOM_DESIGN_DISPLAY_MODES)[number];
export type CustomDesignGap = (typeof CUSTOM_DESIGN_GAPS)[number];

export type CustomDesignBackground =
  | { mode: 'site' }
  | { mode: 'transparent' }
  | { mode: 'custom'; color: string };

export type CustomDesignNormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CustomDesignStartBookingAction = {
  type: 'start_booking';
};

export type CustomDesignDirectionsAction = {
  type: 'directions';
  destination: { address: string };
};

export type CustomDesignInstagramAction = {
  type: 'instagram';
  destination: { username: string };
};

export type CustomDesignWebsiteAction = {
  type: 'website';
  destination: { url: string };
};

export type CustomDesignCallAction = {
  type: 'call';
  destination: { phoneNumber: string };
};

export type CustomDesignTextAction = {
  type: 'text';
  destination: { phoneNumber: string };
};

export type CustomDesignEmailAction = {
  type: 'email';
  destination: { email: string; subject?: string };
};

export type CustomDesignInternalAction = {
  type: 'internal';
  destination: { pageId: string; sectionId?: string };
};

export type CustomDesignSafeUrlAction = {
  type: 'custom_url';
  destination: { url: string };
};

export type CustomDesignAction =
  | CustomDesignStartBookingAction
  | CustomDesignDirectionsAction
  | CustomDesignInstagramAction
  | CustomDesignWebsiteAction
  | CustomDesignCallAction
  | CustomDesignTextAction
  | CustomDesignEmailAction
  | CustomDesignInternalAction
  | CustomDesignSafeUrlAction;

export type CustomDesignAreaValidationStatus = 'valid' | 'invalid';
export type CustomDesignAreaReviewStatus = 'approved' | 'needs_review';
export type CustomDesignAreaReviewReason =
  | 'aspect_ratio_changed'
  | 'owner_review_required';

export type CustomDesignInteractiveArea = {
  id: string;
  geometry: CustomDesignNormalizedRect;
  semanticOrder: number;
  accessibleLabel: string;
  labelConfirmed: boolean;
  action: CustomDesignAction;
  validationStatus: CustomDesignAreaValidationStatus;
  reviewStatus: CustomDesignAreaReviewStatus;
  reviewReason?: CustomDesignAreaReviewReason;
};

export type CustomDesignImageItem = {
  id: string;
  assetId: string;
  fileName: string;
  mimeType: CustomDesignMimeType;
  fileSize: number;
  width: number;
  height: number;
  aspectRatio: number;
  altText: string;
  decorative: boolean;
  accessibleSummary?: string;
  interactiveAreas: CustomDesignInteractiveArea[];
};

export type CustomDesignCtaPlacement =
  | { type: 'after_all' }
  | { type: 'after_image'; imageItemId: string };

export type CustomDesignNativeCta =
  | { type: 'none' }
  | {
      type: 'book_now';
      label: string;
      placement: CustomDesignCtaPlacement;
    }
  | {
      type: 'custom';
      label: string;
      action: CustomDesignAction;
      placement: CustomDesignCtaPlacement;
    };

export type CustomDesignSettings = {
  schemaVersion: typeof CUSTOM_DESIGN_SETTINGS_VERSION;
  images: CustomDesignImageItem[];
  displayMode: CustomDesignDisplayMode;
  gap: CustomDesignGap;
  background: CustomDesignBackground;
  cta: CustomDesignNativeCta;
};

export type CustomDesignValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: string[] };

export type CustomDesignResolvedAction = {
  status: 'resolved';
  href: string;
  external: boolean;
  target?: '_blank';
  rel?: 'noopener noreferrer';
};

export type CustomDesignUnresolvedAction = {
  status: 'unresolved';
  reason:
    | 'invalid_destination'
    | 'booking_unavailable'
    | 'contact_unavailable'
    | 'internal_destination_unavailable';
};

export type CustomDesignActionResolution =
  | CustomDesignResolvedAction
  | CustomDesignUnresolvedAction;

export type CustomDesignActionResolutionContext = {
  bookingHref?: string;
  contactHref?: string;
  resolveInternalHref?: (
    pageId: string,
    sectionId?: string,
  ) => string | null;
};
