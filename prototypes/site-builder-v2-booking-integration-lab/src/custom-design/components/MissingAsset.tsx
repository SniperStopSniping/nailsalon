import { useId } from 'react';

type CustomerMissingAssetProps = {
  fallback?: 'none' | 'placeholder';
};

export function CustomerMissingAsset({
  fallback = 'none',
}: CustomerMissingAssetProps) {
  if (fallback === 'none') {
    return null;
  }

  return (
    <div
      aria-label="Design image unavailable"
      className="custom-design-missing-asset custom-design-missing-asset--customer"
      data-testid="custom-design-customer-missing-asset"
      role="img"
    >
      <span>Design image unavailable</span>
    </div>
  );
}

type OwnerMissingAssetProps = {
  fileName: string;
  reason?: string;
  onReplace: () => void;
};

export function OwnerMissingAsset({
  fileName,
  onReplace,
  reason,
}: OwnerMissingAssetProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="custom-design-missing-asset custom-design-missing-asset--owner"
      data-testid="custom-design-owner-missing-asset"
    >
      <div>
        <h3 id={headingId}>Design file needs replacing</h3>
        <p>
          {reason?.trim()
            || `${fileName} is not available in this browser. The section and link positions are still saved.`}
        </p>
      </div>
      <button type="button" onClick={onReplace}>Replace image</button>
    </section>
  );
}
