/**
 * Shared field primitives for library section editors. These follow the
 * Builder's existing form idioms (.form-field / .form-hint) so every editor
 * reads as one system.
 */

import { useId } from 'react';

import type { BoundText } from '../../model/section-library/settings';

export function TextField({
  hint,
  label,
  maxLength,
  multiline = false,
  onChange,
  placeholder,
  value,
}: {
  hint?: string;
  label: string;
  maxLength?: number;
  multiline?: boolean;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  const hintId = useId();
  const described = hint ? hintId : undefined;
  return (
    <div className="form-field">
      <label className="form-field__label-wrap">
        <span>{label}</span>
        {multiline
          ? (
              <textarea
                aria-describedby={described}
                maxLength={maxLength}
                onChange={event => onChange(event.target.value)}
                placeholder={placeholder}
                value={value}
              />
            )
          : (
              <input
                aria-describedby={described}
                autoComplete="off"
                maxLength={maxLength}
                onChange={event => onChange(event.target.value)}
                placeholder={placeholder}
                type="text"
                value={value}
              />
            )}
      </label>
      {hint ? <small className="form-hint" id={hintId}>{hint}</small> : null}
    </div>
  );
}

export function ToggleField({
  hint,
  label,
  onChange,
  value,
}: {
  hint?: string;
  label: string;
  onChange: (value: boolean) => void;
  value: boolean;
}) {
  const hintId = useId();
  return (
    <div className="form-field form-field--toggle-wrap">
      <label className="form-field--toggle">
        <input
          aria-describedby={hint ? hintId : undefined}
          checked={value}
          onChange={event => onChange(event.target.checked)}
          type="checkbox"
        />
        <span>{label}</span>
      </label>
      {hint ? <small className="form-hint" id={hintId}>{hint}</small> : null}
    </div>
  );
}

export function ChoiceField<T extends string>({
  hint,
  label,
  onChange,
  options,
  value,
}: {
  hint?: string;
  label: string;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
}) {
  const groupId = useId();
  return (
    <div aria-labelledby={groupId} className="form-field" role="group">
      <span id={groupId}>{label}</span>
      <div className="editor-choice-row">
        {options.map(option => (
          <button
            aria-pressed={option.value === value}
            className="editor-choice-chip"
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      {hint ? <small className="form-hint">{hint}</small> : null}
    </div>
  );
}

/**
 * A shared-or-override text value. "Shared" shows the live shared value and
 * follows future profile edits; overriding never rewrites the shared source.
 */
export function BoundTextField({
  label,
  maxLength,
  onChange,
  sharedLabel,
  sharedValue,
  value,
}: {
  label: string;
  maxLength?: number;
  onChange: (value: BoundText) => void;
  sharedLabel: string;
  sharedValue: string;
  value: BoundText;
}) {
  const overriding = value.source === 'override';
  return (
    <div className="form-field">
      <span>{label}</span>
      <div className="editor-choice-row">
        <button
          aria-pressed={!overriding}
          className="editor-choice-chip"
          onClick={() => onChange({ source: 'shared' })}
          type="button"
        >
          {sharedLabel}
        </button>
        <button
          aria-pressed={overriding}
          className="editor-choice-chip"
          onClick={() => onChange({
            source: 'override',
            value: overriding ? value.value : sharedValue,
          })}
          type="button"
        >
          Write my own
        </button>
      </div>
      {overriding
        ? (
            <input
              autoComplete="off"
              maxLength={maxLength}
              onChange={event => onChange({ source: 'override', value: event.target.value })}
              type="text"
              value={value.value}
            />
          )
        : (
            <small className="form-hint">
              Currently: “
              {sharedValue}
              ”
            </small>
          )}
    </div>
  );
}
