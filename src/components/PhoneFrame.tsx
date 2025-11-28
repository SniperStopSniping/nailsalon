import * as React from 'react';

import { cn } from '@/utils/Helpers';

export type PhoneFrameProps = {
  children: React.ReactNode;
  className?: string;
};

export const PhoneFrame = React.forwardRef<HTMLDivElement, PhoneFrameProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'mx-auto max-w-sm rounded-[2.5rem] border-[3px] border-[#d9c6aa] bg-gradient-to-b from-[#fff8ef] to-[#fff3e2] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.3)]',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);
PhoneFrame.displayName = 'PhoneFrame';

