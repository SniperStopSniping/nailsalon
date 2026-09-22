import { TechnicianAvatar } from '@/components/booking/TechnicianAvatar';
import { Card, CardContent } from '@/components/ui/card';
import { themeVars } from '@/theme';
import { formatDuration } from '@/utils/Helpers';

type BookingSummaryCardProps = {
  mounted?: boolean;
  serviceNames: string;
  totalDuration: number;
  totalPrice: number;
  locationName?: string | null;
  technician?: {
    name: string;
    imageUrl: string | null;
  } | null;
  label?: string;
  hasManualConfirmationItems?: boolean;
};

export function BookingSummaryCard({
  mounted = true,
  serviceNames,
  totalDuration,
  totalPrice,
  locationName = null,
  technician,
  label = 'Your appointment',
  hasManualConfirmationItems = false,
}: BookingSummaryCardProps) {
  return (
    <Card
      data-public-surface="appointmentSummaryCard"
      data-testid="booking-summary-card"
      className="mb-4 overflow-hidden border-0 shadow-[0_6px_18px_-12px_rgba(30,20,25,0.3)]"
      style={{
        containerType: 'inline-size',
        containerName: 'booking-summary',
        background: `var(--booking-summary-background, linear-gradient(to bottom right, ${themeVars.accent}, color-mix(in srgb, ${themeVars.accent} 70%, black)))`,
        color: 'var(--booking-summary-foreground, white)',
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
        transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
      }}
    >
      <CardContent className="px-5 py-4">
        <div className="booking-summary-content flex items-center gap-4">
          {technician && (
            <TechnicianAvatar
              name={technician.name}
              imageUrl={technician.imageUrl}
              className="size-14 shrink-0 border-2 border-white/30"
              sizes="56px"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 text-sm">{label}</div>
            <div data-testid="booking-summary-service" className="break-words text-base font-bold">{serviceNames || 'Service'}</div>
            <div data-testid="booking-summary-duration" className="text-sm font-medium" style={{ color: `var(--booking-summary-detail, ${themeVars.primary})` }}>
              {technician ? `with ${technician.name} · ` : ''}
              {formatDuration(totalDuration)}
            </div>
            {hasManualConfirmationItems && (
              <div data-testid="booking-summary-manual-price" className="mt-0.5 text-xs font-semibold">
                Additional item price to be confirmed by your nail tech
              </div>
            )}
            {locationName && (
              <div data-testid="booking-summary-location" className="mt-0.5 break-words text-sm">
                {locationName}
              </div>
            )}
          </div>
          <div className="text-right">
            <div data-testid="booking-summary-price" className="text-2xl font-bold">
              $
              {totalPrice}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
