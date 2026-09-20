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
  const isUnicode = segmentation.encoding === 'ucs2';
  const oneCredit = segmentation.segments === 1;
  const segmentSummary = `${segmentation.segments} SMS segment${segmentation.segments === 1 ? '' : 's'} · ${segmentation.segments} credit${segmentation.segments === 1 ? '' : 's'}`;
  const unitSummary = `${segmentation.billableUnits}/${segmentation.limitForSegments} ${isUnicode ? 'Unicode' : 'GSM-7'} units`;
  const unicodeExamples = segmentation.nonGsmCharacters
    .slice(0, 3)
    .map(character => `U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}`)
    .join(', ');
  const cause = isUnicode
    ? `Unicode characters${unicodeExamples ? ` (${unicodeExamples})` : ''} use fewer characters per SMS segment. Use straight punctuation and avoid emoji or other Unicode characters to preserve GSM-7.`
    : segmentation.segments > 1
      ? 'Message length is causing an additional SMS segment.'
      : null;

  return (
    <div className={`rounded-xl bg-[var(--owner-blush)] p-3 ${className}`} data-testid="sms-message-preview">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">
          {sample ? 'Sample customer message' : 'Customer message'}
        </p>
        <p aria-live="polite" className="text-xs font-semibold text-[var(--owner-muted)]" data-testid="sms-segment-summary">{segmentSummary}</p>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--owner-ink)]">{body}</p>
      <p className="mt-2 text-xs text-[var(--owner-muted)]">{unitSummary}</p>
      {cause && <p className="mt-1 text-xs text-[var(--owner-muted)]">{cause}</p>}
      {!oneCredit && <p className="mt-2 text-xs font-medium text-[var(--owner-muted)]">Keep this to 1 credit by shortening the message or link.</p>}
    </div>
  );
}
