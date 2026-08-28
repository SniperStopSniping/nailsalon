import {
  useId,
  useRef,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  error?: string;
  hint?: string;
  label: string;
};

export function TextField({ error, hint, label, ...inputProps }: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className={`onboarding-field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input
        {...inputProps}
        aria-describedby={describedBy}
        aria-invalid={error ? 'true' : undefined}
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
              onChange={() => onChange(option.value)}
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

  return (
    <div className="onboarding-switch-row">
      <span>
        <label htmlFor={id}>{label}</label>
        {description ? <small id={descriptionId}>{description}</small> : null}
      </span>
      <input
        aria-describedby={description ? descriptionId : undefined}
        checked={checked}
        disabled={disabled}
        id={id}
        role="switch"
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  );
}

type CollapsibleFormCardProps = {
  children: ReactNode;
  completed?: boolean;
  id: string;
  onToggle: () => void;
  open: boolean;
  summary?: string;
  title: string;
};

export function CollapsibleFormCard({
  children,
  completed = false,
  id,
  onToggle,
  open,
  summary,
  title,
}: CollapsibleFormCardProps) {
  const panelId = `${id}-panel`;

  return (
    <section className={`onboarding-collapsible-card${completed ? ' is-complete' : ''}`}>
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
        {completed ? <span>Complete</span> : null}
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
  label: string;
  onRemove?: () => void;
  onSelect: (file: File) => void;
};

export function ImageUploadField({
  accept = 'image/png,image/jpeg,image/webp',
  currentLabel,
  label,
  onRemove,
  onSelect,
}: ImageUploadFieldProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onSelect(file);
    event.target.value = '';
  };

  return (
    <div className="onboarding-image-upload">
      <span id={`${id}-label`}>{label}</span>
      {currentLabel ? <p>{currentLabel}</p> : null}
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
        <button type="button" onClick={() => inputRef.current?.click()}>
          {currentLabel ? 'Replace' : 'Choose from files or photos'}
        </button>
        {currentLabel && onRemove ? (
          <button type="button" onClick={onRemove}>Remove</button>
        ) : null}
      </div>
    </div>
  );
}
