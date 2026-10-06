import { prepareSmsBody } from '@/libs/smsSegments';

export function SmsMessagePreview({
  body,
  sample = false,
  className = '',
}: {
  body: string;
  /** The variables below are illustrative rather than a specific recipient's final message. */
  sample?: boolean;
  className?: string;
}) {
  const { segmentation } = prepareSmsBody(body);
  const oneCredit = segmentation.segments === 1;
  const creditSummary = `${segmentation.segments} text credit${oneCredit ? '' : 's'}`;

  return (
    <div className={`rounded-xl bg-[var(--owner-blush)] p-3 ${className}`} data-testid="sms-message-preview">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
          {sample ? 'Sample customer message' : 'Customer message'}
        </p>
        <p aria-live="polite" className="text-xs font-semibold text-[var(--owner-muted)]" data-testid="sms-segment-summary">{creditSummary}</p>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--owner-ink)]">{body}</p>
      {!oneCredit && <p className="mt-2 text-xs font-medium text-[var(--owner-muted)]">Long messages and emoji can use more credits. Shorten the message or link to use fewer.</p>}
    </div>
  );
}
