import * as React from 'react';
import { Button, ButtonProps } from './Button';

/**
 * SecondaryButton - Neutral button variant
 * 
 * This is a convenience wrapper around the unified Button component
 * with variant="secondary" for backward compatibility.
 * 
 * @deprecated Consider using <Button variant="secondary" /> directly
 */
export const SecondaryButton = React.forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, 'variant'>
>((props, ref) => {
  return <Button ref={ref} variant="secondary" {...props} />;
});
SecondaryButton.displayName = 'SecondaryButton';

