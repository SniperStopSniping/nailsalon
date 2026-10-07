import type { ComponentProps } from 'react';

// Browser-fixture adapter for Next navigation. Preserve real anchor semantics.
export default function Link({ children, ...props }: ComponentProps<'a'>) {
  return <a {...props}>{children}</a>;
}
