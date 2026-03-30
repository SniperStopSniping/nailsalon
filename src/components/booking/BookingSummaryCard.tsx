import { TechnicianAvatar } from '@/components/booking/TechnicianAvatar';
import { Card, CardContent } from '@/components/ui/card';
import { themeVars } from '@/theme';

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
};

export function BookingSummaryCard({
  mounted = true,
  serviceNames,
  totalDuration,
  totalPrice,
  locationName = null,
  technician,
  label = 'Your appointment',
}: BookingSummaryCardProps) {
  return (
    <Card
      data-testid="booking-summary-card"
      className="mb-6 overflow-hidden border-0 shadow-xl"
      style={{
        background: `linear-gradient(to bottom right, ${themeVars.accent}, color-mix(in srgb, ${themeVars.accent} 70%, black))`,
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
        transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
      }}
    >
      <CardContent className="px-5 py-4">
        <div className="flex items-center gap-4">
          {technician && (
            <TechnicianAvatar
              name={technician.name}
              imageUrl={technician.imageUrl}
              className="size-14 shrink-0 border-2 border-white/30"
              sizes="56px"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 text-xs text-white/70">{label}</div>
            <div data-testid="booking-summary-service" className="truncate text-base font-bold text-white">{serviceNames || 'Service'}</div>
            <div data-testid="booking-summary-duration" className="text-sm font-medium" style={{ color: themeVars.primary }}>
              {technician ? `with ${technician.name} · ` : ''}
              {totalDuration}
              {' '}
              min
            </div>
            {locationName && (
              <div data-testid="booking-summary-location" className="mt-0.5 truncate text-xs text-white/75">
                {locationName}
              </div>
            )}
          </div>
          <div className="text-right">
            <div data-testid="booking-summary-price" className="text-2xl font-bold text-white">
              $
              {totalPrice}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
