import * as React from 'react';
import { cn } from '@/utils/Helpers';

export interface MainCardProps {
  children: React.ReactNode;
  showGoldBar?: boolean;
  animateGoldBar?: boolean;
  className?: string;
}

export const MainCard = React.forwardRef<HTMLDivElement, MainCardProps>(
  ({ children, showGoldBar = false, animateGoldBar = false, className }, ref) => {
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
          'w-full rounded-2xl bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.08)] overflow-hidden',
          className
        )}
      >
        {(showGoldBar || animateGoldBar) && (
          <div
            className="h-1 bg-gradient-to-r from-[#d6a249] to-[#f4b864]"
            style={
              animateGoldBar
                ? {
                    width: goldBarVisible ? "100%" : "0%",
                    transition: "width 400ms ease-out",
                  }
                : undefined
            }
          />
        )}
        <div className="px-5 py-6">{children}</div>
      </div>
    );
  }
);
MainCard.displayName = 'MainCard';

