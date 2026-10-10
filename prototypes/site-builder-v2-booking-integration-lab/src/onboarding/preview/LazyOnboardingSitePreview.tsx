import { type ComponentProps, lazy } from 'react';

import { DeferredSetupContent } from '../components/DeferredSetupContent';
import type { OnboardingSitePreview } from './OnboardingSitePreview';

const Preview = lazy(() => import('./OnboardingSitePreview').then(module => ({ default: module.OnboardingSitePreview })));

export function LazyOnboardingSitePreview(props: ComponentProps<typeof OnboardingSitePreview>) {
  return (
    <DeferredSetupContent label="Opening your preview…">
      <Preview {...props} />
    </DeferredSetupContent>
  );
}
