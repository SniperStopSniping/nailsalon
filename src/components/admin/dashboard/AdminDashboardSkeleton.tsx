import { SkeletonWidgets } from '@/components/admin/SkeletonWidgets';

export function AdminDashboardSkeleton() {
  return (
    <div className="min-h-screen bg-[#F2F2F7]">
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
