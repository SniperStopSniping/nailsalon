import * as React from 'react';
import { cn } from '@/utils/Helpers';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'default' | 'sm';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

/**
 * Unified Button Component
 * 
 * A minimal, premium button component that serves as the single source of truth
 * for all buttons across the customer-facing app.
 * 
 * Variants:
 * - primary: Gold background (#f4b864) with dark text
 * - secondary: Neutral background with light border
 * - ghost: Text-only with minimal border
 * 
 * All buttons share:
 * - Pill-shaped rounded corners (rounded-full)
 * - Consistent padding (px-5 py-3.5 default, px-4 py-2.5 sm)
 * - Uniform height
 * - Consistent font sizing (text-base default, text-sm sm)
 * - Subtle shadow
 * - Smooth hover + press animations
 * - Same disabled state styling
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'primary',
      size = 'default',
      fullWidth = true,
      className,
      disabled,
      ...props
    },
    ref
  ) => {
    const baseClasses = cn(
      // Base styles - consistent across all variants
      'inline-flex items-center justify-center',
      'rounded-full', // Pill-shaped
      'font-semibold', // Base font weight
      'transition-all duration-200 ease-out', // Smooth animations
      'focus:outline-none focus:ring-2 focus:ring-[#d6a249] focus:ring-offset-2',
      'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
      
      // Size variants
      size === 'default' && 'px-5 py-3.5 text-base',
      size === 'sm' && 'px-4 py-2.5 text-sm',
      
      // Full width
      fullWidth && 'w-full',
      
      // Variant-specific styles
      variant === 'primary' && [
        'bg-[#f4b864]', // Gold background
        'text-neutral-900', // Dark text for contrast
        'font-bold', // Bold for primary
        'shadow-sm', // Subtle shadow
        'hover:scale-[1.02] hover:shadow-md hover:bg-[#f4b864]/90', // Hover lift
        'active:scale-[0.97]', // Press animation
      ],
      
      variant === 'secondary' && [
        'bg-neutral-50', // Neutral background
        'text-neutral-700', // Medium text
        'font-semibold', // Semibold for secondary
        'border border-neutral-200', // Light border
        'shadow-sm', // Softer shadow
        'hover:scale-[1.01] hover:bg-neutral-100 hover:shadow-sm', // Subtle hover
        'active:scale-[0.98]', // Gentle press
      ],
      
      variant === 'ghost' && [
        'bg-transparent', // No background
        'text-neutral-700', // Medium text
        'font-semibold', // Semibold
        'border border-neutral-200', // Minimal border
        'hover:bg-neutral-50 hover:border-neutral-300', // Subtle hover
        'active:scale-[0.98]', // Gentle press
      ],
      
      className
    );

    return (
      <button
        ref={ref}
        className={baseClasses}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

