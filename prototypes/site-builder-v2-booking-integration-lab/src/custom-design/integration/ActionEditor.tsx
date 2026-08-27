import { useId, useState } from 'react';

import { parseCustomDesignAction } from '../model/actions';
import type { CustomDesignAction } from '../model/types';
import type { CustomDesignInternalPageOption } from './ui-types';

export type CustomDesignActionType = CustomDesignAction['type'];

export const CUSTOM_DESIGN_ACTION_OPTIONS: readonly {
  label: string;
  type: CustomDesignActionType;
}[] = [
  { label: 'Start booking', type: 'start_booking' },
  { label: 'Location / directions', type: 'directions' },
  { label: 'Instagram', type: 'instagram' },
  { label: 'Website', type: 'website' },
  { label: 'Call', type: 'call' },
  { label: 'Text', type: 'text' },
  { label: 'Email', type: 'email' },
  { label: 'Internal Luster page or section', type: 'internal' },
  { label: 'Custom safe URL', type: 'custom_url' },
];

type ActionDraft = {
  address: string;
  email: string;
  internalPageId: string;
  internalSectionId: string;
  phoneNumber: string;
  subject: string;
  type: CustomDesignActionType;
  url: string;
  username: string;
};

const actionToDraft = (
  action: CustomDesignAction | null,
  internalTargets: readonly CustomDesignInternalPageOption[],
  fallbackType: CustomDesignActionType = 'start_booking',
): ActionDraft => {
  const firstPageId = internalTargets[0]?.id ?? '';
  const empty: ActionDraft = {
    address: '',
    email: '',
    internalPageId: firstPageId,
    internalSectionId: '',
    phoneNumber: '',
    subject: '',
    type: action?.type ?? fallbackType,
    url: '',
    username: '',
  };

  if (!action || action.type === 'start_booking') return empty;
  switch (action.type) {
    case 'directions':
      return { ...empty, address: action.destination.address };
    case 'instagram':
      return { ...empty, username: action.destination.username };
    case 'website':
    case 'custom_url':
      return { ...empty, url: action.destination.url };
    case 'call':
    case 'text':
      return { ...empty, phoneNumber: action.destination.phoneNumber };
    case 'email':
      return {
        ...empty,
        email: action.destination.email,
        subject: action.destination.subject ?? '',
      };
    case 'internal':
      return {
        ...empty,
        internalPageId: action.destination.pageId,
        internalSectionId: action.destination.sectionId ?? '',
      };
  }
};

const draftToCandidate = (draft: ActionDraft): unknown => {
  switch (draft.type) {
    case 'start_booking':
      return { type: 'start_booking' };
    case 'directions':
      return { type: 'directions', destination: { address: draft.address } };
    case 'instagram':
      return { type: 'instagram', destination: { username: draft.username } };
    case 'website':
    case 'custom_url':
      return { type: draft.type, destination: { url: draft.url } };
    case 'call':
    case 'text':
      return {
        type: draft.type,
        destination: { phoneNumber: draft.phoneNumber },
      };
    case 'email':
      return {
        type: 'email',
        destination: {
          email: draft.email,
          ...(draft.subject.trim() ? { subject: draft.subject } : {}),
        },
      };
    case 'internal':
      return {
        type: 'internal',
        destination: {
          pageId: draft.internalPageId,
          ...(draft.internalSectionId
            ? { sectionId: draft.internalSectionId }
            : {}),
        },
      };
  }
};

type ActionEditorProps = {
  action: CustomDesignAction | null;
  allowedTypes?: readonly CustomDesignActionType[];
  disabled?: boolean;
  idPrefix?: string;
  internalTargets?: readonly CustomDesignInternalPageOption[];
  onChange: (action: CustomDesignAction | null) => void;
  onValidityChange?: (valid: boolean) => void;
};

/**
 * Keeps temporarily invalid text local while emitting only parsed, structured
 * actions. Give the component a new React `key` to reset it to another action.
 */
export function ActionEditor({
  action,
  allowedTypes,
  disabled = false,
  idPrefix,
  internalTargets = [],
  onChange,
  onValidityChange,
}: ActionEditorProps) {
  const generatedId = useId();
  const controlId = idPrefix ?? `custom-design-action-${generatedId}`;
  const options = CUSTOM_DESIGN_ACTION_OPTIONS.filter(option =>
    !allowedTypes || allowedTypes.includes(option.type));
  const initialAction = action && options.some(option => option.type === action.type)
    ? action
    : options[0]?.type === 'start_booking'
      ? { type: 'start_booking' as const }
      : null;
  const fallbackType = options[0]?.type ?? 'start_booking';
  const [draft, setDraft] = useState<ActionDraft>(() =>
    actionToDraft(initialAction, internalTargets, fallbackType));
  const [valid, setValid] = useState(() =>
    parseCustomDesignAction(draftToCandidate(
      actionToDraft(initialAction, internalTargets, fallbackType),
    )) !== null);

  const updateDraft = (next: ActionDraft) => {
    setDraft(next);
    const parsed = parseCustomDesignAction(draftToCandidate(next));
    const isValid = parsed !== null;
    setValid(isValid);
    onChange(parsed);
    onValidityChange?.(isValid);
  };

  const selectedPage = internalTargets.find(page => page.id === draft.internalPageId);

  return (
    <fieldset className="custom-design-action-editor" disabled={disabled}>
      <legend>Action</legend>
      <label htmlFor={`${controlId}-type`}>What should happen?</label>
      <select
        id={`${controlId}-type`}
        value={draft.type}
        onChange={(event) => {
          const type = event.target.value as CustomDesignActionType;
          const next = {
            ...draft,
            type,
            ...(type === 'internal' && !draft.internalPageId
              ? { internalPageId: internalTargets[0]?.id ?? '' }
              : {}),
          };
          updateDraft(next);
        }}
      >
        {options.map(option => (
          <option key={option.type} value={option.type}>{option.label}</option>
        ))}
      </select>

      {draft.type === 'directions' ? (
        <label htmlFor={`${controlId}-address`}>
          Address
          <textarea
            id={`${controlId}-address`}
            rows={3}
            value={draft.address}
            onChange={event => updateDraft({ ...draft, address: event.target.value })}
          />
        </label>
      ) : null}
      {draft.type === 'instagram' ? (
        <label htmlFor={`${controlId}-username`}>
          Instagram username
          <input
            autoCapitalize="none"
            id={`${controlId}-username`}
            placeholder="@yourstudio"
            spellCheck={false}
            value={draft.username}
            onChange={event => updateDraft({ ...draft, username: event.target.value })}
          />
        </label>
      ) : null}
      {draft.type === 'website' || draft.type === 'custom_url' ? (
        <label htmlFor={`${controlId}-url`}>
          Secure URL
          <input
            autoCapitalize="none"
            id={`${controlId}-url`}
            inputMode="url"
            placeholder="https://example.com"
            spellCheck={false}
            type="url"
            value={draft.url}
            onChange={event => updateDraft({ ...draft, url: event.target.value })}
          />
        </label>
      ) : null}
      {draft.type === 'call' || draft.type === 'text' ? (
        <label htmlFor={`${controlId}-phone`}>
          Phone number
          <input
            autoComplete="tel"
            id={`${controlId}-phone`}
            inputMode="tel"
            placeholder="+1 416 555 0123"
            type="tel"
            value={draft.phoneNumber}
            onChange={event => updateDraft({ ...draft, phoneNumber: event.target.value })}
          />
        </label>
      ) : null}
      {draft.type === 'email' ? (
        <>
          <label htmlFor={`${controlId}-email`}>
            Email address
            <input
              autoCapitalize="none"
              autoComplete="email"
              id={`${controlId}-email`}
              inputMode="email"
              type="email"
              value={draft.email}
              onChange={event => updateDraft({ ...draft, email: event.target.value })}
            />
          </label>
          <label htmlFor={`${controlId}-subject`}>
            Subject <span aria-hidden="true">(optional)</span>
            <input
              id={`${controlId}-subject`}
              value={draft.subject}
              onChange={event => updateDraft({ ...draft, subject: event.target.value })}
            />
          </label>
        </>
      ) : null}
      {draft.type === 'internal' ? (
        <>
          <label htmlFor={`${controlId}-page`}>
            Luster page
            <select
              id={`${controlId}-page`}
              value={draft.internalPageId}
              onChange={(event) => updateDraft({
                ...draft,
                internalPageId: event.target.value,
                internalSectionId: '',
              })}
            >
              {internalTargets.length === 0 ? (
                <option value="">No page available</option>
              ) : null}
              {internalTargets.map(page => (
                <option key={page.id} value={page.id}>
                  {page.label}{page.visible ? '' : ' · hidden'}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={`${controlId}-section`}>
            Section <span aria-hidden="true">(optional)</span>
            <select
              id={`${controlId}-section`}
              value={draft.internalSectionId}
              onChange={event => updateDraft({
                ...draft,
                internalSectionId: event.target.value,
              })}
            >
              <option value="">Top of page</option>
              {selectedPage?.sections.map(section => (
                <option key={section.id} value={section.id}>
                  {section.label}{section.visible ? '' : ' · hidden'}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}

      {!valid ? (
        <p className="custom-design-owner-field-error" role="status">
          Enter a complete, safe destination.
        </p>
      ) : null}
    </fieldset>
  );
}
