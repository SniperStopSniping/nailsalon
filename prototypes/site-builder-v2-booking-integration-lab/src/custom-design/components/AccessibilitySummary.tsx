type AccessibilitySummaryProps = {
  fileName: string;
  imageItemId: string;
  summary?: string;
};

export function AccessibilitySummary({
  fileName,
  imageItemId,
  summary,
}: AccessibilitySummaryProps) {
  const trimmedSummary = summary?.trim();
  if (!trimmedSummary) {
    return null;
  }

  return (
    <details
      className="custom-design-accessible-summary"
      data-testid={`custom-design-summary-${imageItemId}`}
    >
      <summary>{`Text version of ${fileName}`}</summary>
      <div className="custom-design-accessible-summary__text">
        {trimmedSummary}
      </div>
    </details>
  );
}
