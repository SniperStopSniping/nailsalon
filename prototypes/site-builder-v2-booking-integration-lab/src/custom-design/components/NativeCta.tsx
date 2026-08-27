import type { CustomDesignNativeCta } from '../model/types';
import { isSafeRenderedHref, SemanticAction } from './SemanticAction';
import type {
  CustomDesignScrollPositionReader,
  ResolveCustomDesignAction,
} from './view-types';

type ActiveNativeCta = Exclude<CustomDesignNativeCta, { type: 'none' }>;

type NativeCtaProps = {
  cta: ActiveNativeCta;
  getScrollPosition?: CustomDesignScrollPositionReader;
  resolveAction: ResolveCustomDesignAction;
};

export function NativeCta({
  cta,
  getScrollPosition,
  resolveAction,
}: NativeCtaProps) {
  const resolution = resolveAction(
    cta.type === 'custom' ? cta.action : null,
    { cta, type: 'cta' },
  );

  if (
    resolution.status === 'unresolved'
    || (resolution.status === 'resolved' && !isSafeRenderedHref(resolution.href))
  ) {
    return null;
  }

  return (
    <div
      className="custom-design-native-cta-wrap"
      data-cta-kind={cta.type}
      data-testid={`custom-design-cta-${cta.type}`}
    >
      <SemanticAction
        accessibleLabel={cta.label}
        className="custom-design-native-cta"
        getScrollPosition={getScrollPosition}
        resolution={resolution}
      >
        {cta.label}
      </SemanticAction>
    </div>
  );
}
