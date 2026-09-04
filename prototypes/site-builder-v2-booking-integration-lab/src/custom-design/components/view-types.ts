import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
} from 'react';

import type {
  CustomDesignAction,
  CustomDesignImageItem,
  CustomDesignInteractiveArea,
  CustomDesignNativeCta,
  CustomDesignResolvedAction,
  CustomDesignUnresolvedAction,
} from '../model/types';

export type CustomDesignResolvedAsset =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'missing'; reason?: string };

export type ResolveCustomDesignAsset = (
  assetId: string,
  image: CustomDesignImageItem,
) => CustomDesignResolvedAsset;

export type CustomDesignButtonResolution = {
  status: 'button';
  onActivate: (event: ReactMouseEvent<HTMLButtonElement>) => void;
};

export type CustomDesignLinkResolution = CustomDesignResolvedAction & {
  onActivate?: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
};

export type CustomDesignRenderResolution =
  | CustomDesignLinkResolution
  | CustomDesignUnresolvedAction
  | CustomDesignButtonResolution;

export type CustomDesignActionSource =
  | {
    type: 'area';
    area: CustomDesignInteractiveArea;
    image: CustomDesignImageItem;
  }
  | { type: 'cta'; cta: Exclude<CustomDesignNativeCta, { type: 'none' }> };

export type ResolveCustomDesignAction = (
  action: CustomDesignAction | null,
  source: CustomDesignActionSource,
) => CustomDesignRenderResolution;

export type CustomDesignScrollPositionReader = () => {
  x: number;
  y: number;
};

export type CustomDesignSectionStyle = CSSProperties & {
  '--custom-design-background'?: string;
  '--custom-design-content-max-width'?: string;
  '--custom-design-poster-max-width'?: string;
};
