import * as React from 'react';
import { Button, ButtonProps } from './Button';

/**
 * PrimaryButton - Gold button variant
 * 
 * This is a convenience wrapper around the unified Button component
 * with variant="primary" for backward compatibility.
 * 
 * @deprecated Consider using <Button variant="primary" /> directly
 */
export const PrimaryButton = React.forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, 'variant'>
>((props, ref) => {
  return <Button ref={ref} variant="primary" {...props} />;
});
PrimaryButton.displayName = 'PrimaryButton';

