import { SkeletonWidgets } from '@/components/admin/SkeletonWidgets';

/**
 * Loading gate for the workspace.
 *
 * It paints the workspace's own ground (--owner-ground) rather than the iOS
 * cool grey it used to, so the app does not change temperature as it boots,
 * and it fades nothing in: the skeleton and the dashboard share a ground, so
 * the hand-over is invisible instead of a cool-grey → warm flash.
 */
export function AdminDashboardSkeleton() {
  return (
    <div
      className="owner-workspace-theme min-h-screen bg-[var(--owner-ground)]"
      data-theme-scope="owner"
      data-testid="admin-dashboard-skeleton"
    >
      <div style={{ paddingTop: 'env(safe-area-inset-top, 20px)' }}>
        <div className="flex items-center justify-between px-5 py-3">
          <div>
            <div className="h-8 w-32 animate-pulse rounded-lg bg-gray-200" />
            <div className="mt-1 h-4 w-24 animate-pulse rounded bg-gray-100" />
          </div>
          <div className="flex items-center gap-3">
            <div className="size-9 animate-pulse rounded-full bg-gray-200" />
            <div className="size-9 animate-pulse rounded-full bg-gray-200" />
          </div>
        </div>
        <SkeletonWidgets />
      </div>
    </div>
  );
}
