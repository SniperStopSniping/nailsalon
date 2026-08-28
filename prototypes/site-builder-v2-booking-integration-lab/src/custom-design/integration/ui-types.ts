import type {
  CustomDesignAction,
  CustomDesignImageItem,
} from '../model/types';

export type CustomDesignOwnerAssetState =
  | { status: 'loading' }
  | { status: 'ready'; url: string; thumbnailUrl?: string }
  | { status: 'missing' | 'error'; reason?: string };

export type CustomDesignOwnerAssetMap = Readonly<
  Record<string, CustomDesignOwnerAssetState | undefined>
>;

export type CustomDesignInternalSectionOption = {
  id: string;
  label: string;
  visible: boolean;
};

export type CustomDesignInternalPageOption = {
  id: string;
  label: string;
  sections: readonly CustomDesignInternalSectionOption[];
  visible: boolean;
};

export type CustomDesignUploadFailure = {
  code?: string;
  fileName: string;
  message: string;
};

export type CustomDesignUploadStatus = {
  failures?: readonly CustomDesignUploadFailure[];
  message?: string;
  pending: boolean;
};

export type CustomDesignReadinessIssue = {
  action?: CustomDesignAction;
  areaId?: string;
  code: string;
  imageItemId?: string;
  message: string;
};

export type CustomDesignAccessibilityUpdate = Pick<
  CustomDesignImageItem,
  'accessibleSummary' | 'altText' | 'decorative'
>;
