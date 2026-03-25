'use client';

import { AlertTriangle } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/ui/section-card';
import { cn } from '@/utils/Helpers';

type ImpersonationSession = {
  salonId: string;
  salonSlug: string;
  salonName: string;
  adminUserId: string;
  adminPhone: string;
  startedAt: string;
};

type ImpersonationStatus = {
  isImpersonating: boolean;
  session: ImpersonationSession | null;
};

type AdminImpersonationBannerProps = {
  className?: string;
};

export function AdminImpersonationBanner({
  className,
}: AdminImpersonationBannerProps) {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en';

  const [session, setSession] = useState<ImpersonationSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const response = await fetch('/api/super-admin/impersonate', {
          cache: 'no-store',
        });

        if (cancelled) {
          return;
        }

        if (response.status === 401 || response.status === 403) {
          setSession(null);
          setError(null);
          return;
        }

        const body = await response.json();

        if (!response.ok) {
          throw new Error(body.error ?? 'Failed to load impersonation status');
        }

        const data = body as ImpersonationStatus;
        setSession(data.isImpersonating ? data.session : null);
        setError(null);
      } catch (loadError) {
        if (!cancelled) {
          setSession(null);
          setError(loadError instanceof Error ? loadError.message : 'Failed to load impersonation status');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleEndImpersonation = async () => {
    try {
      setEnding(true);
      setError(null);

      const response = await fetch('/api/super-admin/impersonate', {
        method: 'DELETE',
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body.error ?? 'Failed to end impersonation');
      }

      setSession(null);
      router.push(`/${locale}/super-admin`);
      router.refresh();
    } catch (endError) {
      setError(endError instanceof Error ? endError.message : 'Failed to end impersonation');
    } finally {
      setEnding(false);
    }
  };

  if (loading || !session) {
    return null;
  }

  return (
    <div className={cn('mx-4 mt-3', className)} data-testid="admin-impersonation-banner">
      <SectionCard
        className="border-amber-300 bg-amber-50/95 shadow-sm"
        contentClassName="space-y-3"
        title={(
          <div className="flex items-center gap-2 text-amber-950">
            <AlertTriangle className="size-4" />
            <span>Impersonating: {session.salonName}</span>
          </div>
        )}
        description="You are acting as salon admin in this salon. Actions remain tied to your real super-admin account."
        actions={(
          <Button
            type="button"
            data-testid="admin-end-impersonation"
            variant="brandSoft"
            size="sm"
            disabled={ending}
            onClick={handleEndImpersonation}
          >
            {ending ? 'Ending…' : 'End impersonation'}
          </Button>
        )}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-amber-900/80">
          <span>Salon scope is locked to `{session.salonSlug}`.</span>
          <span>Started {new Date(session.startedAt).toLocaleString()}.</span>
        </div>
        {error && (
          <p className="text-sm text-red-700">{error}</p>
        )}
      </SectionCard>
    </div>
  );
}
