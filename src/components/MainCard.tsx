import * as React from 'react';

import { themeVars } from '@/theme';
import { cn } from '@/utils/Helpers';

export interface MainCardProps {
  children: React.ReactNode;
  showGoldBar?: boolean;
  animateGoldBar?: boolean;
  className?: string;
}

/**
 * MainCard Component
 *
 * Primary container for card-based content. Uses theme CSS variables
 * for brand-colored borders and accent bars.
 */
export const MainCard = React.forwardRef<HTMLDivElement, MainCardProps>(
  (
    { children, showGoldBar = false, animateGoldBar = false, className },
    ref,
  ) => {
    const [goldBarVisible, setGoldBarVisible] = React.useState(false);

    React.useEffect(() => {
      if (animateGoldBar) {
        setGoldBarVisible(false);
        setTimeout(() => setGoldBarVisible(true), 50);
      } else {
        setGoldBarVisible(showGoldBar);
      }
    }, [showGoldBar, animateGoldBar]);

    return (
      <div
        ref={ref}
        className={cn(
          `w-full rounded-2xl bg-white border border-[${themeVars.cardBorder}] shadow-[0_4px_20px_rgba(0,0,0,0.08)] overflow-hidden`,
          className,
        )}
      >
        {(showGoldBar || animateGoldBar) && (
          <div
            className="h-1"
            style={{
              background: `linear-gradient(to right, ${themeVars.primaryDark}, ${themeVars.primary})`,
              width: animateGoldBar ? (goldBarVisible ? '100%' : '0%') : '100%',
              transition: animateGoldBar ? 'width 400ms ease-out' : undefined,
            }}
          />
        )}
        <div className="px-5 py-6">{children}</div>
      </div>
    );
  },
);
MainCard.displayName = 'MainCard';

