import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

import { useFeedback } from '../feedback/useFeedback';

export const focusAndRevealControl = (
  target: HTMLElement,
  targetGroup: HTMLElement = target,
  summary?: HTMLElement | null,
): void => {
  target.focus({ preventScroll: true });
  const headerBottom = [
    document.querySelector<HTMLElement>('.onboarding-shell__header'),
    document.querySelector<HTMLElement>('.onboarding-shell__progress'),
  ].reduce((bottom, element) => Math.max(
    bottom,
    element?.getBoundingClientRect().bottom ?? 0,
  ), 0);
  const stickyActionsTop = document
    .querySelector<HTMLElement>('.sticky-onboarding-actions')
    ?.getBoundingClientRect().top;
  const viewportBottom = Math.min(
    window.visualViewport?.height ?? window.innerHeight,
    stickyActionsTop && stickyActionsTop > 0
      ? stickyActionsTop
      : Number.POSITIVE_INFINITY,
  );
  const safeTop = headerBottom + 8;
  const safeBottom = viewportBottom - 8;

  if (summary) {
    summary.classList.add('is-revealed');
    summary.style.setProperty(
      '--onboarding-validation-sticky-top',
      `${safeTop}px`,
    );
  }

  targetGroup.scrollIntoView?.({ block: 'center', inline: 'nearest' });

  let targetRect = target.getBoundingClientRect();
  if (targetRect.width === 0 && targetRect.height === 0) return;
  let summaryRect = summary?.getBoundingClientRect();

  if (summaryRect && summaryRect.top < safeTop) {
    window.scrollBy({ behavior: 'auto', top: summaryRect.top - safeTop });
    summaryRect = summary?.getBoundingClientRect() ?? summaryRect;
    targetRect = target.getBoundingClientRect();
  }

  const targetSafeTop = summaryRect
    && summaryRect.top >= safeTop - 1
    && summaryRect.bottom < safeBottom
    ? summaryRect.bottom + 8
    : safeTop;

  if (targetRect.bottom > safeBottom) {
    window.scrollBy({ behavior: 'auto', top: targetRect.bottom - safeBottom });
  } else if (targetRect.top < targetSafeTop) {
    window.scrollBy({ behavior: 'auto', top: targetRect.top - targetSafeTop });
  }
};

export const focusFirstInvalidControl = (root: Element): void => {
  window.requestAnimationFrame(() => {
    const invalid = root.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!invalid) return;
    const target = invalid.matches('input, textarea, select, button, [tabindex]')
      ? invalid
      : invalid.querySelector<HTMLElement>(
          'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? invalid;
    const invalidGroup = target.closest<HTMLElement>(
      '.onboarding-field, .onboarding-choice-group, .onboarding-contact-uses, [aria-invalid="true"]',
    ) ?? invalid;
    const summary = root.querySelector<HTMLElement>('.onboarding-validation-summary');
    summary?.scrollIntoView?.({ block: 'start', inline: 'nearest' });
    focusAndRevealControl(target, invalidGroup, summary);
  });
};

export function ValidationSummary({
  errors,
  onSelectError,
}: {
  errors: Record<string, string>;
  onSelectError?: (fieldId: string) => void;
}) {
  const entries = Object.entries(errors).filter((entry): entry is [string, string] => Boolean(entry[1]));
  if (entries.length === 0) return null;
  return (
    <div className="onboarding-validation-summary" role="alert">
      <strong>Check the highlighted information.</strong>
      <span>{entries.length === 1
        ? '1 answer needs attention.'
        : `${entries.length} answers need attention.`}</span>
      <ul>
        {entries.map(([fieldId, message]) => (
          <li key={fieldId}>
            {onSelectError ? (
              <button type="button" onClick={() => onSelectError(fieldId)}>{message}</button>
            ) : message}
          </li>
        ))}
      </ul>
    </div>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  error?: string;
  hint?: string;
  label: string;
};

export function TextField({
  'aria-describedby': externalDescribedBy,
  'aria-invalid': externalInvalid,
  error,
  hint,
  label,
  ...inputProps
}: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [externalDescribedBy, hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className={`onboarding-field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input
        {...inputProps}
        aria-describedby={describedBy}
        aria-invalid={error ? 'true' : externalInvalid}
        id={id}
      />
      {hint ? <p className="onboarding-field__hint" id={hintId}>{hint}</p> : null}
      {error ? <p className="onboarding-field__error" id={errorId}>{error}</p> : null}
    </div>
  );
}
type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & {
  error?: string;
  hint?: string;
  label: string;
};

export function TextAreaField({
  error,
  hint,
  label,
  ...textareaProps
}: TextAreaFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className={`onboarding-field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <textarea
        {...textareaProps}
        aria-describedby={describedBy}
        aria-invalid={error ? 'true' : undefined}
        id={id}
      />
      {hint ? <p className="onboarding-field__hint" id={hintId}>{hint}</p> : null}
      {error ? <p className="onboarding-field__error" id={errorId}>{error}</p> : null}
    </div>
  );
}

export type ChoiceOption<T extends string> = {
  description?: string;
  label: string;
  value: T;
};

type ChoiceGroupProps<T extends string> = {
  error?: string;
  legend: string;
  name: string;
  onChange: (value: T) => void;
  options: readonly ChoiceOption<T>[];
  value: T | '' | null | undefined;
};

export function ChoiceGroup<T extends string>({
  error,
  legend,
  name,
  onChange,
  options,
  value,
}: ChoiceGroupProps<T>) {
  const errorId = useId();
  const feedback = useFeedback();

  return (
    <fieldset
      aria-describedby={error ? errorId : undefined}
      aria-invalid={error ? 'true' : undefined}
      className={`onboarding-choice-group${error ? ' has-error' : ''}`}
    >
      <legend>{legend}</legend>
      <div className="onboarding-choice-group__options">
        {options.map((option) => (
          <label className="onboarding-choice" key={option.value}>
            <input
              checked={value === option.value}
              name={name}
              type="radio"
              value={option.value}
              onChange={() => {
                feedback.send({ kind: 'selection' });
                onChange(option.value);
              }}
            />
            <span>
              <strong>{option.label}</strong>
              {option.description ? <small>{option.description}</small> : null}
            </span>
          </label>
        ))}
      </div>
      {error ? <p className="onboarding-field__error" id={errorId}>{error}</p> : null}
    </fieldset>
  );
}

type NativeSwitchProps = {
  checked: boolean;
  description?: string;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
};

export function NativeSwitch({
  checked,
  description,
  disabled = false,
  label,
  onChange,
}: NativeSwitchProps) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const feedback = useFeedback();

  return (
    <div className="onboarding-switch-row">
      <span>
        <label htmlFor={id}>{label}</label>
        {description ? <small id={descriptionId}>{description}</small> : null}
      </span>
      <label className="onboarding-switch-control" htmlFor={id}>
        <input
          aria-describedby={description ? descriptionId : undefined}
          aria-label={label}
          checked={checked}
          disabled={disabled}
          id={id}
          role="switch"
          type="checkbox"
          onChange={(event) => {
            feedback.send({ kind: 'selection' });
            onChange(event.target.checked);
          }}
        />
      </label>
    </div>
  );
}

type CollapsibleFormCardProps = {
  children: ReactNode;
  completed?: boolean;
  errorCount?: number;
  id: string;
  onToggle: () => void;
  open: boolean;
  summary?: string;
  status?: 'set_up' | 'finish' | 'complete' | 'not_shown';
  title: string;
};

export function CollapsibleFormCard({
  children,
  completed = false,
  errorCount = 0,
  id,
  onToggle,
  open,
  summary,
  status,
  title,
}: CollapsibleFormCardProps) {
  const panelId = `${id}-panel`;
  const feedback = useFeedback();
  const resolvedStatus = errorCount > 0
    ? 'finish'
    : status ?? (completed ? 'complete' : 'set_up');
  const statusLabel = resolvedStatus === 'complete'
    ? 'Complete'
    : resolvedStatus === 'not_shown'
      ? 'Not shown'
      : resolvedStatus === 'finish'
        ? 'Finish'
        : 'Set up';
  const previousStatusRef = useRef(resolvedStatus);

  useEffect(() => {
    if (previousStatusRef.current !== 'complete' && resolvedStatus === 'complete') {
      feedback.send({
        kind: 'completed',
        message: `${title} complete`,
        targetId: id,
      });
    }
    previousStatusRef.current = resolvedStatus;
  }, [feedback, id, resolvedStatus, title]);

  return (
    <section
      aria-invalid={errorCount > 0 ? 'true' : undefined}
      className={`onboarding-collapsible-card is-${resolvedStatus}${open ? ' is-open' : ''}${errorCount > 0 ? ' has-error' : ''}`}
    >
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className="onboarding-collapsible-card__trigger"
        type="button"
        onClick={onToggle}
      >
        <span>
          <strong>{title}</strong>
          {summary ? <small>{summary}</small> : null}
        </span>
        <span className="onboarding-collapsible-card__state">
          <span className={errorCount > 0 ? 'is-error' : undefined}>
            {errorCount > 0
              ? `${statusLabel} · ${errorCount} ${errorCount === 1 ? 'issue' : 'issues'}`
              : statusLabel}
          </span>
          <span aria-hidden="true" className="onboarding-collapsible-card__chevron">
            {resolvedStatus === 'complete' && !open ? (
              <Check size={15} strokeWidth={2.5} />
            ) : open ? (
              <ChevronUp size={16} />
            ) : (
              <ChevronDown size={16} />
            )}
          </span>
        </span>
      </button>
      <div hidden={!open} id={panelId}>
        {children}
      </div>
    </section>
  );
}

type ImageUploadFieldProps = {
  accept?: string;
  currentLabel?: string;
  currentSummary?: string;
  chooseLabel?: string;
  label: string;
  needsReselect?: boolean;
  onRemove?: () => void;
  onSelect: (file: File) => Promise<void> | void;
  previewUrl?: string;
  readyLabel?: string;
};

export function ImageUploadField({
  accept = 'image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif',
  chooseLabel = 'Choose from files or photos',
  currentLabel,
  currentSummary,
  label,
  needsReselect = false,
  onRemove,
  onSelect,
  previewUrl,
  readyLabel = 'Photo ready',
}: ImageUploadFieldProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const retryFileRef = useRef<File | null>(null);
  const [processingFileName, setProcessingFileName] = useState('');
  const [failure, setFailure] = useState('');
  const feedback = useFeedback();
  const processing = Boolean(processingFileName);

  const processFile = async (file: File) => {
    retryFileRef.current = file;
    setFailure('');
    setProcessingFileName(file.name);
    try {
      await onSelect(file);
      retryFileRef.current = null;
      feedback.send({ announce: false, kind: 'added', message: readyLabel });
    } catch (cause) {
      setFailure(cause instanceof Error
        ? cause.message
        : 'This photo couldn’t be saved. Try selecting it again or choose another copy.');
    } finally {
      setProcessingFileName('');
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void processFile(file);
    event.target.value = '';
  };

  const remove = () => {
    retryFileRef.current = null;
    setFailure('');
    onRemove?.();
    feedback.send({ kind: 'removed', message: `${label} removed` });
  };

  return (
    <div className={`onboarding-image-upload${processing ? ' is-processing' : ''}${failure ? ' has-error' : ''}${currentLabel && !needsReselect ? ' is-ready' : ''}`}>
      <span id={`${id}-label`}>{label}</span>
      {processing ? (
        <div aria-live="polite" className="onboarding-image-upload__status" role="status">
          <span aria-hidden="true" className="onboarding-image-upload__spinner" />
          <span><strong>Processing photo…</strong><small>{processingFileName}</small></span>
        </div>
      ) : currentLabel && !needsReselect ? (
        <div aria-live="polite" className="onboarding-image-upload__status is-ready" role="status">
          {previewUrl ? <img alt="" src={previewUrl} /> : <span aria-hidden="true" className="onboarding-image-upload__ready-mark"><Check size={18} /></span>}
          <span><strong>{readyLabel}</strong><small>{currentLabel}{currentSummary ? ` · ${currentSummary}` : ''}</small></span>
        </div>
      ) : null}
      {needsReselect ? (
        <p role="status">This saved image is no longer available on this device. Select it again to restore it.</p>
      ) : null}
      {failure ? (
        <div aria-live="assertive" className="onboarding-image-upload__failure" role="alert">
          <strong>{retryFileRef.current?.name ?? 'Selected image'}</strong>
          <span>{failure}</span>
          <div>
            {retryFileRef.current ? (
              <button disabled={processing} type="button" onClick={() => {
                const file = retryFileRef.current;
                if (file) void processFile(file);
              }}>Retry</button>
            ) : null}
            <button disabled={processing} type="button" onClick={() => inputRef.current?.click()}>Choose another image</button>
          </div>
        </div>
      ) : null}
      <input
        ref={inputRef}
        accept={accept}
        aria-labelledby={`${id}-label`}
        className="visually-hidden"
        id={id}
        type="file"
        onChange={handleChange}
      />
      <div className="onboarding-image-upload__actions">
        <button disabled={processing} type="button" onClick={() => inputRef.current?.click()}>
          {needsReselect ? 'Select again' : currentLabel ? 'Replace' : chooseLabel}
        </button>
        {currentLabel && onRemove ? (
          <button disabled={processing} type="button" onClick={remove}>Remove</button>
        ) : null}
      </div>
    </div>
  );
}
