import type { SiteContentKey } from './content-placement';

export const HARD_SITE_UNIQUE_CONTENT_KEYS = [
  'owner_profile_photo',
  'brand_logo',
  'instagram',
  'phone',
  'text',
  'email',
  'exact_address',
  'business_hours',
  'deposit_cancellation_policy',
  'before_you_book_policies',
] as const satisfies readonly SiteContentKey[];

export const HARD_PAGE_UNIQUE_CONTENT_KEYS = [
  'service_marketing',
  'service_catalogue',
  'gallery_media',
  'reviews',
  'team_profiles',
  'custom_design',
] as const satisfies readonly SiteContentKey[];

export type CustomerContentUniquenessViolation = {
  count: number;
  key: string;
  kind: 'page_content' | 'site_content' | 'media_role';
  pageId: string | null;
};

const renderedMarkers = (
  root: ParentNode,
  selector: string,
): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(selector)]
  .filter(element => !element.closest('[hidden], [aria-hidden="true"]'));

/**
 * Audit-only semantic assertion. It deliberately consumes stable ownership
 * markers rather than brittle text, layout, or translated link labels.
 */
export const inspectCustomerContentUniqueness = (
  root: ParentNode,
): CustomerContentUniquenessViolation[] => {
  const violations: CustomerContentUniquenessViolation[] = [];

  for (const key of HARD_SITE_UNIQUE_CONTENT_KEYS) {
    const count = renderedMarkers(root, `[data-content-key="${key}"]`).length;
    if (count > 1) {
      violations.push({ count, key, kind: 'site_content', pageId: null });
    }
  }

  const pages = renderedMarkers(root, '[data-preview-page-id]');
  for (const page of pages) {
    for (const key of HARD_PAGE_UNIQUE_CONTENT_KEYS) {
      const count = renderedMarkers(page, `[data-content-key="${key}"]`).length;
      if (count > 1) {
        violations.push({
          count,
          key,
          kind: 'page_content',
          pageId: page.dataset.previewPageId ?? null,
        });
      }
    }
  }

  const rolesByAsset = new Map<string, Set<string>>();
  for (const media of renderedMarkers(root, '[data-media-id][data-media-role]')) {
    const assetId = media.dataset.mediaId;
    const role = media.dataset.mediaRole;
    if (!assetId || !role) {
      continue;
    }
    const roles = rolesByAsset.get(assetId) ?? new Set<string>();
    roles.add(role);
    rolesByAsset.set(assetId, roles);
  }
  for (const [assetId, roles] of rolesByAsset) {
    if (roles.size > 1) {
      violations.push({
        count: roles.size,
        key: assetId,
        kind: 'media_role',
        pageId: null,
      });
    }
  }

  return violations;
};

export const assertCustomerContentUniqueness = (root: ParentNode): void => {
  const violations = inspectCustomerContentUniqueness(root);
  if (violations.length === 0) {
    return;
  }
  throw new Error(`Customer content uniqueness failed: ${JSON.stringify(violations)}`);
};
