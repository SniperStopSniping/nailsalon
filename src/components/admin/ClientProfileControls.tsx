'use client';

import {
  Archive,
  ArchiveRestore,
  LoaderCircle,
  Pencil,
  Search,
  Trash2,
  UserRoundSearch,
} from 'lucide-react';
import {
  type FormEvent,
  type ReactNode,
  useMemo,
  useState,
} from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DialogShell } from '@/components/ui/dialog-shell';
import { formatMoney } from '@/libs/formatMoney';
import { normalizePhone } from '@/libs/phone';

export type ClientProfileControlProfile = {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  notes: string | null;
  preferredTechnicianId: string | null;
  preferredTechnicianName: string | null;
  rebookIntervalDays: number | null;
  updatedAt: string;
  archivedAt: string | null;
  mergedIntoClientId: string | null;
  canManageLifecycle: boolean;
  canPermanentlyDelete: boolean;
};

type ClientProfileControlsProps = {
  salonSlug: string;
  currency: string;
  profile: ClientProfileControlProfile;
  onUpdated: (profile: ClientProfileControlProfile) => void;
  onViewClient: (id: string) => void;
  onMerged: (primaryId: string) => void;
  onRemoved: () => void;
};

type JsonObject = Record<string, unknown>;

type ClientCandidate = {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  notes: string | null;
  preferredTechnicianId: string | null;
  preferredTechnicianName: string | null;
  rebookIntervalDays: number | null;
  updatedAt: string | null;
  archivedAt: string | null;
  mergedIntoClientId: string | null;
  isBlocked: boolean | null;
  blockedReason: string | null;
  hasImportantFlag: boolean | null;
  importantFlagReason: string | null;
  tags: string[] | null;
  preferenceSummary: string[] | null;
};

type MergeConflict = {
  key: string;
  label: string;
  primaryValue: unknown;
  duplicateValue: unknown;
  defaultSelection: 'primary' | 'duplicate';
};

type MergePreview = {
  primary: ClientCandidate;
  duplicate: ClientCandidate;
  counts: Array<{ key: string; label: string; count: number }>;
  conflicts: MergeConflict[];
  primaryVersion: string;
  duplicateVersion: string;
};

type EditDraft = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  birthday: string;
};

const INPUT_CLASS_NAME = 'mt-1 min-h-11 w-full min-w-0 rounded-xl border border-stone-200 bg-white px-3 py-2 text-base text-stone-900 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100 sm:text-sm';
const SECONDARY_BUTTON_CLASS_NAME = 'min-h-11 min-w-0 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY_BUTTON_CLASS_NAME = 'min-h-11 min-w-0 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50';

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function humanizeKey(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function responseData(payload: unknown): JsonObject {
  const root = asObject(payload) ?? {};
  return asObject(root.data) ?? root;
}

function normalizeCandidate(value: unknown, fallback?: Partial<ClientCandidate>): ClientCandidate | null {
  const wrapper = asObject(value);
  const candidate = asObject(wrapper?.client) ?? wrapper;
  const id = asString(candidate?.id) ?? fallback?.id ?? null;
  if (!id) {
    return null;
  }

  const adminFlags = asObject(candidate?.adminFlags);
  const adminFlagsReported = candidate
    ? Object.prototype.hasOwnProperty.call(candidate, 'adminFlags')
    : false;
  const firstName = asNullableString(candidate?.firstName) ?? fallback?.firstName ?? null;
  const lastName = asNullableString(candidate?.lastName) ?? fallback?.lastName ?? null;
  const composedName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const nailPreferences = asObject(candidate?.nailPreferences);
  const preferredTechnician = asObject(candidate?.preferredTechnician);
  const preferenceSummary = nailPreferences
    ? Object.entries(nailPreferences)
      .filter(([, entry]) => entry !== null && entry !== undefined && entry !== '')
      .map(([key, entry]) => `${humanizeKey(key)}: ${displayValue(entry)}`)
    : [];
  const sensitivities = asNullableString(candidate?.sensitivities);
  if (sensitivities) {
    preferenceSummary.push(`Sensitivities: ${sensitivities}`);
  }
  if (typeof candidate?.rebookIntervalDays === 'number') {
    preferenceSummary.push(`Rebook interval: ${candidate.rebookIntervalDays} days`);
  }
  const externalPreferences = Array.isArray(wrapper?.externalPreferences)
    ? wrapper.externalPreferences.length
    : null;
  if (externalPreferences) {
    preferenceSummary.push(
      `${externalPreferences} submitted preference ${externalPreferences === 1 ? 'profile' : 'profiles'}`,
    );
  }

  return {
    id,
    fullName: asNullableString(candidate?.fullName)
      ?? asNullableString(candidate?.name)
      ?? fallback?.fullName
      ?? composedName
      ?? null,
    firstName,
    lastName,
    phone: asNullableString(candidate?.phone) ?? fallback?.phone ?? null,
    email: asNullableString(candidate?.email) ?? fallback?.email ?? null,
    birthday: asNullableString(candidate?.birthday) ?? fallback?.birthday ?? null,
    notes: asNullableString(candidate?.notes) ?? fallback?.notes ?? null,
    preferredTechnicianId: asNullableString(candidate?.preferredTechnicianId)
      ?? asNullableString(preferredTechnician?.id)
      ?? fallback?.preferredTechnicianId
      ?? null,
    preferredTechnicianName: asNullableString(candidate?.preferredTechnicianName)
      ?? asNullableString(preferredTechnician?.name)
      ?? fallback?.preferredTechnicianName
      ?? null,
    rebookIntervalDays: asNumber(candidate?.rebookIntervalDays)
      ?? fallback?.rebookIntervalDays
      ?? null,
    updatedAt: asNullableString(candidate?.updatedAt) ?? fallback?.updatedAt ?? null,
    archivedAt: asNullableString(candidate?.archivedAt) ?? fallback?.archivedAt ?? null,
    mergedIntoClientId: asNullableString(candidate?.mergedIntoClientId)
      ?? fallback?.mergedIntoClientId
      ?? null,
    isBlocked: asBoolean(candidate?.isBlocked) ?? fallback?.isBlocked ?? null,
    blockedReason: asNullableString(candidate?.blockedReason) ?? fallback?.blockedReason ?? null,
    hasImportantFlag: asBoolean(adminFlags?.isProblemClient)
      ?? fallback?.hasImportantFlag
      ?? (adminFlagsReported ? false : null),
    importantFlagReason: asNullableString(adminFlags?.flagReason)
      ?? fallback?.importantFlagReason
      ?? null,
    tags: asStringArray(candidate?.tags) ?? fallback?.tags ?? null,
    preferenceSummary: preferenceSummary.length > 0
      ? preferenceSummary
      : fallback?.preferenceSummary ?? (nailPreferences ? [] : null),
  };
}

function profileAsCandidate(profile: ClientProfileControlProfile): ClientCandidate {
  return {
    ...profile,
    updatedAt: profile.updatedAt,
    isBlocked: null,
    blockedReason: null,
    hasImportantFlag: null,
    importantFlagReason: null,
    tags: null,
    preferenceSummary: null,
  };
}

function displayName(client: Pick<ClientCandidate, 'fullName' | 'firstName' | 'lastName'>): string {
  return client.fullName
    || [client.firstName, client.lastName].filter(Boolean).join(' ').trim()
    || 'Unnamed client';
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return 'Not provided';
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(displayValue).join(', ') : 'None';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return 'Saved value';
    }
  }
  return String(value);
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  const root = asObject(payload);
  const error = asObject(root?.error);
  return asString(root?.message)
    ?? asString(root?.error)
    ?? asString(error?.message)
    ?? fallback;
}

function extractDuplicate(payload: unknown): ClientCandidate | null {
  const root = asObject(payload) ?? {};
  const data = asObject(root.data) ?? {};
  const error = asObject(root.error) ?? {};
  const details = asObject(error.details) ?? asObject(root.details) ?? {};
  const candidates = [
    data.possibleDuplicate,
    data.duplicate,
    data.existingClient,
    root.possibleDuplicate,
    root.duplicate,
    root.existingClient,
    details.possibleDuplicate,
    details.duplicate,
    details.existingClient,
    details.client,
  ];

  for (const value of candidates) {
    const candidate = normalizeCandidate(value);
    if (candidate) {
      return candidate;
    }
  }

  const duplicateLists = [
    data.possibleDuplicates,
    data.duplicates,
    root.possibleDuplicates,
    root.duplicates,
    error.possibleDuplicates,
    error.duplicates,
    details.possibleDuplicates,
    details.duplicates,
  ];
  for (const value of duplicateLists) {
    if (!Array.isArray(value)) {
      continue;
    }
    const candidate = normalizeCandidate(value[0]);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function extractSearchResults(payload: unknown): ClientCandidate[] {
  const data = responseData(payload);
  const values = Array.isArray(data.clients)
    ? data.clients
    : Array.isArray(data.results)
      ? data.results
      : Array.isArray(data.items)
        ? data.items
        : [];

  return values
    .map(value => normalizeCandidate(value))
    .filter((value): value is ClientCandidate => value !== null);
}

function flattenCounts(value: unknown, prefix = '', depth = 0): Array<{ key: string; label: string; count: number }> {
  if (depth > 2) {
    return [];
  }
  const object = asObject(value);
  if (!object) {
    return [];
  }

  return Object.entries(object).flatMap(([key, entry]) => {
    const compoundKey = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      return [{
        key: compoundKey,
        label: humanizeKey(compoundKey.replace(/\./g, ' ')),
        count: entry,
      }];
    }
    return flattenCounts(entry, compoundKey, depth + 1);
  });
}

function parseConflict(value: unknown, fallbackKey?: string): MergeConflict | null {
  const conflict = asObject(value);
  if (!conflict) {
    return null;
  }
  const key = asString(conflict.key)
    ?? asString(conflict.field)
    ?? fallbackKey
    ?? null;
  if (!key) {
    return null;
  }
  const requestedDefault = asString(conflict.defaultSelection)
    ?? asString(conflict.selectedSource)
    ?? asString(conflict.default);

  return {
    key,
    label: asString(conflict.label) ?? humanizeKey(key),
    primaryValue: conflict.primaryValue ?? conflict.primary ?? conflict.keep,
    duplicateValue: conflict.duplicateValue ?? conflict.duplicate ?? conflict.merge,
    defaultSelection: requestedDefault === 'duplicate' ? 'duplicate' : 'primary',
  };
}

function extractConflicts(value: unknown): MergeConflict[] {
  if (Array.isArray(value)) {
    return value
      .map(entry => parseConflict(entry))
      .filter((entry): entry is MergeConflict => entry !== null);
  }
  const object = asObject(value);
  if (!object) {
    return [];
  }
  return Object.entries(object)
    .map(([key, entry]) => parseConflict(entry, key))
    .filter((entry): entry is MergeConflict => entry !== null);
}

function extractMergePreview(
  payload: unknown,
  current: ClientCandidate,
  selected: ClientCandidate,
): MergePreview {
  const data = responseData(payload);
  const preview = asObject(data.preview) ?? data;
  const clients = asObject(preview.clients) ?? asObject(data.clients) ?? {};
  const primarySource = preview.primary
    ?? preview.primaryClient
    ?? clients.primary
    ?? data.primary
    ?? data.primaryClient;
  const duplicateSource = preview.duplicate
    ?? preview.duplicateClient
    ?? clients.duplicate
    ?? data.duplicate
    ?? data.duplicateClient;
  const primarySide = asObject(primarySource) ?? {};
  const duplicateSide = asObject(duplicateSource) ?? {};
  const primary = normalizeCandidate(
    primarySource,
    current,
  ) ?? current;
  const duplicate = normalizeCandidate(
    duplicateSource,
    selected,
  ) ?? selected;
  const recordSource = preview.recordCounts
    ?? preview.counts
    ?? preview.recordSummary
    ?? preview.summary
    ?? data.recordCounts
    ?? data.counts
    ?? data.recordSummary
    ?? data.summary
    ?? duplicateSide.records
    ?? primarySide.records
    ?? {};
  const conflicts = extractConflicts(
    preview.conflicts
    ?? preview.fieldConflicts
    ?? preview.conflictingFields
    ?? data.conflicts
    ?? data.fieldConflicts
    ?? data.conflictingFields,
  );
  const versions = asObject(preview.versions) ?? asObject(data.versions) ?? {};

  return {
    primary,
    duplicate,
    counts: flattenCounts(recordSource),
    conflicts,
    primaryVersion: asString(versions.primary)
      ?? primary.updatedAt
      ?? current.updatedAt
      ?? '',
    duplicateVersion: asString(versions.duplicate)
      ?? duplicate.updatedAt
      ?? selected.updatedAt
      ?? '',
  };
}

async function parseResponse(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `client-merge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function draftForProfile(profile: ClientProfileControlProfile): EditDraft {
  return {
    firstName: profile.firstName ?? '',
    lastName: profile.lastName ?? '',
    phone: profile.phone ?? '',
    email: profile.email ?? '',
    birthday: profile.birthday?.slice(0, 10) ?? '',
  };
}

function ClientControlAction({
  icon,
  label,
  tone = 'default',
  onClick,
}: {
  icon: ReactNode;
  label: string;
  tone?: 'default' | 'danger';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-12 min-w-0 items-center gap-2 rounded-2xl border bg-white px-3 py-2 text-left text-[13px] font-semibold shadow-sm transition active:scale-[0.98] ${
        tone === 'danger'
          ? 'border-red-200 text-red-700'
          : 'border-stone-200 text-stone-800'
      }`}
    >
      <span
        className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
          tone === 'danger' ? 'bg-red-50 text-red-700' : 'bg-rose-50 text-rose-700'
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 break-words">{label}</span>
    </button>
  );
}

function ProfileSummaryCard({
  eyebrow,
  client,
}: {
  eyebrow: string;
  client: ClientCandidate;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-stone-200 bg-stone-50 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-stone-500">{eyebrow}</p>
      <h3 className="mt-1 break-words text-base font-semibold text-stone-900">
        {displayName(client)}
      </h3>
      <dl className="mt-2 space-y-1 text-sm text-stone-600">
        <div className="min-w-0">
          <dt className="sr-only">Phone</dt>
          <dd className="break-words">{client.phone || 'No phone'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="sr-only">Email</dt>
          <dd className="break-all">{client.email || 'No email'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-semibold text-stone-700">Birthday</dt>
          <dd className="break-words">{client.birthday || 'Not provided'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-semibold text-stone-700">Preferred technician</dt>
          <dd className="break-all">
            {client.preferredTechnicianName
            || client.preferredTechnicianId
            || 'Not provided'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-semibold text-stone-700">Rebook interval</dt>
          <dd>
            {client.rebookIntervalDays
              ? `${client.rebookIntervalDays} days`
              : 'Not provided'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-semibold text-stone-700">Current note</dt>
          <dd className="whitespace-pre-wrap break-words">{client.notes || 'None'}</dd>
        </div>
      </dl>
      <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 text-xs">
        <div className="min-w-0 rounded-xl bg-white px-3 py-2 text-stone-600">
          <p className="font-semibold text-stone-800">Tags</p>
          <p className="mt-1 break-words">
            {client.tags === null
              ? 'Not reported'
              : client.tags.length > 0
                ? client.tags.join(', ')
                : 'None'}
          </p>
        </div>
        <div className="min-w-0 rounded-xl bg-white px-3 py-2 text-stone-600">
          <p className="font-semibold text-stone-800">Preferences</p>
          <p className="mt-1 break-words">
            {client.preferenceSummary === null
              ? 'Not reported'
              : client.preferenceSummary.length > 0
                ? client.preferenceSummary.join(' · ')
                : 'None'}
          </p>
        </div>
        <div
          className={`min-w-0 rounded-xl px-3 py-2 ${
            client.isBlocked === true
              ? 'bg-red-50 text-red-900'
              : 'bg-white text-stone-600'
          }`}
        >
          <p className="font-semibold">
            {client.isBlocked === true
              ? 'Blocked'
              : client.isBlocked === false
                ? 'Not blocked'
                : 'Blocking status not reported'}
          </p>
          {client.blockedReason && (
            <p className="mt-1 break-words leading-5">{client.blockedReason}</p>
          )}
        </div>
        <div
          className={`min-w-0 rounded-xl px-3 py-2 ${
            client.hasImportantFlag === true
              ? 'bg-amber-50 text-amber-950'
              : 'bg-white text-stone-600'
          }`}
        >
          <p className="font-semibold">
            {client.hasImportantFlag === true
              ? 'Important flag'
              : client.hasImportantFlag === false
                ? 'No important flag'
                : 'Important flag status not reported'}
          </p>
          {client.importantFlagReason && (
            <p className="mt-1 break-words leading-5">{client.importantFlagReason}</p>
          )}
        </div>
      </div>
    </section>
  );
}

export function ClientProfileControls({
  salonSlug,
  currency,
  profile,
  onUpdated,
  onViewClient,
  onMerged,
  onRemoved,
}: ClientProfileControlsProps) {
  const [dialog, setDialog] = useState<'edit' | 'merge' | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft>(() => draftForProfile(profile));
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [possibleDuplicate, setPossibleDuplicate] = useState<ClientCandidate | null>(null);

  const [mergeQuery, setMergeQuery] = useState('');
  const [mergeSearchBusy, setMergeSearchBusy] = useState(false);
  const [mergeSearchError, setMergeSearchError] = useState<string | null>(null);
  const [mergeResults, setMergeResults] = useState<ClientCandidate[]>([]);
  const [mergePreviewBusy, setMergePreviewBusy] = useState(false);
  const [mergePreview, setMergePreview] = useState<MergePreview | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [fieldSelections, setFieldSelections] = useState<Record<string, 'primary' | 'duplicate'>>({});
  const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false);
  const [mergeAcknowledged, setMergeAcknowledged] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');

  const [confirmAction, setConfirmAction] = useState<'archive' | 'restore' | 'delete' | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  const currentCandidate = useMemo(() => profileAsCandidate(profile), [profile]);

  const closeEdit = () => {
    if (editBusy) {
      return;
    }
    setDialog(null);
    setEditError(null);
    setPossibleDuplicate(null);
  };

  const openEdit = () => {
    setEditDraft(draftForProfile(profile));
    setEditError(null);
    setPossibleDuplicate(null);
    setDialog('edit');
  };

  const openMerge = () => {
    setMergeQuery('');
    setMergeResults([]);
    setMergeSearchError(null);
    setMergePreview(null);
    setMergeError(null);
    setFieldSelections({});
    setMergeAcknowledged(false);
    setIdempotencyKey('');
    setDialog('merge');
  };

  const closeMerge = () => {
    if (mergeBusy || mergePreviewBusy) {
      return;
    }
    setDialog(null);
    setMergeConfirmOpen(false);
    setMergeError(null);
  };

  const submitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEditBusy(true);
    setEditError(null);
    setPossibleDuplicate(null);

    try {
      const submittedFirstName = editDraft.firstName.trim();
      const submittedLastName = editDraft.lastName.trim();
      const response = await fetch(`/api/admin/clients/${encodeURIComponent(profile.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          firstName: submittedFirstName || null,
          lastName: submittedLastName || null,
          fullName: [submittedFirstName, submittedLastName].filter(Boolean).join(' '),
          phone: normalizePhone(editDraft.phone),
          email: normalizeEmail(editDraft.email),
          birthday: editDraft.birthday || null,
          expectedUpdatedAt: profile.updatedAt,
        }),
      });
      const payload = await parseResponse(response);

      if (!response.ok) {
        const duplicate = response.status === 409 ? extractDuplicate(payload) : null;
        if (duplicate) {
          setPossibleDuplicate(duplicate);
          setEditError('A possible duplicate already uses this phone number or email.');
          return;
        }
        setEditError(extractErrorMessage(payload, 'Client details could not be saved.'));
        return;
      }

      const data = responseData(payload);
      const responseProfile = normalizeCandidate(data.client ?? data.profile ?? data, {
        ...currentCandidate,
        firstName: editDraft.firstName.trim() || null,
        lastName: editDraft.lastName.trim() || null,
        phone: normalizePhone(editDraft.phone),
        email: normalizeEmail(editDraft.email),
        birthday: editDraft.birthday || null,
      });
      const updatedAt = responseProfile?.updatedAt ?? profile.updatedAt;
      const firstName = responseProfile?.firstName ?? (editDraft.firstName.trim() || null);
      const lastName = responseProfile?.lastName ?? (editDraft.lastName.trim() || null);

      onUpdated({
        ...profile,
        ...responseProfile,
        id: profile.id,
        fullName: responseProfile?.fullName
          || [firstName, lastName].filter(Boolean).join(' ').trim()
          || null,
        firstName,
        lastName,
        phone: responseProfile?.phone ?? normalizePhone(editDraft.phone),
        email: responseProfile?.email ?? normalizeEmail(editDraft.email),
        birthday: responseProfile?.birthday ?? (editDraft.birthday || null),
        updatedAt,
        canPermanentlyDelete: profile.canPermanentlyDelete,
      });
      setDialog(null);
    } catch {
      setEditError('Client details could not be saved. Check your connection and try again.');
    } finally {
      setEditBusy(false);
    }
  };

  const searchClients = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = mergeQuery.trim();
    if (!query) {
      setMergeSearchError('Enter a name, phone number, or email.');
      return;
    }

    setMergeSearchBusy(true);
    setMergeSearchError(null);
    setMergePreview(null);
    try {
      const scopedResults = await Promise.all(
        (['active', 'archived'] as const).map(async (scope) => {
          const parameters = new URLSearchParams({
            salonSlug,
            search: query,
            scope,
            limit: '20',
          });
          const response = await fetch(`/api/admin/clients?${parameters.toString()}`);
          const payload = await parseResponse(response);
          if (!response.ok) {
            throw new Error(extractErrorMessage(payload, 'Clients could not be searched.'));
          }
          return extractSearchResults(payload);
        }),
      );
      const results = [...new Map(
        scopedResults
          .flat()
          .filter(candidate => (
            candidate.id !== profile.id
            && !candidate.mergedIntoClientId
          ))
          .map(candidate => [candidate.id, candidate]),
      ).values()];
      setMergeResults(results);
      if (results.length === 0) {
        setMergeSearchError('No other active or archived clients matched this search.');
      }
    } catch (error) {
      setMergeSearchError(
        error instanceof Error
          ? error.message
          : 'Clients could not be searched. Check your connection and try again.',
      );
    } finally {
      setMergeSearchBusy(false);
    }
  };

  const loadMergePreview = async (duplicate: ClientCandidate) => {
    setDialog('merge');
    setMergePreviewBusy(true);
    setMergeError(null);
    setMergePreview(null);
    setMergeAcknowledged(false);
    setIdempotencyKey(createIdempotencyKey());

    try {
      const response = await fetch(
        `/api/admin/clients/${encodeURIComponent(profile.id)}/merge/preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            salonSlug,
            duplicateClientId: duplicate.id,
            primaryClientId: profile.id,
          }),
        },
      );
      const payload = await parseResponse(response);
      if (!response.ok) {
        setMergeError(extractErrorMessage(payload, 'The merge preview could not be loaded.'));
        return;
      }

      const preview = extractMergePreview(payload, currentCandidate, duplicate);
      setMergePreview(preview);
      setFieldSelections(Object.fromEntries(
        preview.conflicts.map(conflict => [conflict.key, conflict.defaultSelection]),
      ));
    } catch {
      setMergeError('The merge preview could not be loaded. Check your connection and try again.');
    } finally {
      setMergePreviewBusy(false);
    }
  };

  const startMergeFromDuplicateWarning = () => {
    if (!possibleDuplicate) {
      return;
    }
    const duplicate = possibleDuplicate;
    setEditError(null);
    setPossibleDuplicate(null);
    void loadMergePreview(duplicate);
  };

  const submitMerge = async () => {
    if (!mergePreview || !mergeAcknowledged) {
      return;
    }

    setMergeBusy(true);
    setMergeError(null);
    try {
      const response = await fetch(
        `/api/admin/clients/${encodeURIComponent(profile.id)}/merge`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({
            salonSlug,
            primaryClientId: mergePreview.primary.id,
            duplicateClientId: mergePreview.duplicate.id,
            expectedPrimaryUpdatedAt: mergePreview.primaryVersion,
            expectedDuplicateUpdatedAt: mergePreview.duplicateVersion,
            versions: {
              primary: mergePreview.primaryVersion,
              duplicate: mergePreview.duplicateVersion,
            },
            selections: fieldSelections,
            fieldSelections,
            idempotencyKey,
          }),
        },
      );
      const payload = await parseResponse(response);
      if (!response.ok) {
        setMergeError(extractErrorMessage(
          payload,
          response.status === 409
            ? 'One of these profiles changed. Reload the preview before merging.'
            : 'The profiles could not be merged.',
        ));
        setMergeConfirmOpen(false);
        return;
      }
      const data = responseData(payload);
      const primary = normalizeCandidate(data.primary ?? data.primaryClient);
      const result = asObject(data.result) ?? {};
      const primaryId = asString(data.primaryClientId)
        ?? asString(result.primaryClientId)
        ?? primary?.id
        ?? mergePreview.primary.id;
      setMergeConfirmOpen(false);
      setDialog(null);
      onMerged(primaryId);
    } catch {
      setMergeError('The profiles could not be merged. Check your connection and try again.');
      setMergeConfirmOpen(false);
    } finally {
      setMergeBusy(false);
    }
  };

  const runLifecycleAction = async () => {
    if (!confirmAction) {
      return;
    }
    const action = confirmAction;
    setLifecycleBusy(true);
    setLifecycleError(null);

    try {
      const url = action === 'delete'
        ? `/api/admin/clients/${encodeURIComponent(profile.id)}`
        : `/api/admin/clients/${encodeURIComponent(profile.id)}/${action}`;
      const response = await fetch(url, {
        method: action === 'delete' ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          expectedUpdatedAt: profile.updatedAt,
        }),
      });
      const payload = await parseResponse(response);
      if (!response.ok) {
        setLifecycleError(extractErrorMessage(payload, `The client could not be ${action}d.`));
        return;
      }

      setConfirmAction(null);
      if (action === 'delete') {
        onRemoved();
        return;
      }

      const data = responseData(payload);
      const management = asObject(data.management) ?? {};
      const responseProfile = normalizeCandidate(data.client ?? data.profile ?? data, currentCandidate);
      onUpdated({
        ...profile,
        ...responseProfile,
        id: profile.id,
        updatedAt: responseProfile?.updatedAt ?? profile.updatedAt,
        archivedAt: action === 'archive'
          ? responseProfile?.archivedAt ?? new Date().toISOString()
          : null,
        canPermanentlyDelete: typeof (data.canPermanentlyDelete ?? management.canPermanentlyDelete) === 'boolean'
          ? Boolean(data.canPermanentlyDelete ?? management.canPermanentlyDelete)
          : profile.canPermanentlyDelete,
      });
    } catch {
      setLifecycleError(`The client could not be ${action}d. Check your connection and try again.`);
    } finally {
      setLifecycleBusy(false);
    }
  };

  if (profile.mergedIntoClientId) {
    return (
      <div className="contents">
        <ClientControlAction
          icon={<UserRoundSearch size={15} />}
          label="View primary client"
          onClick={() => onViewClient(profile.mergedIntoClientId as string)}
        />
      </div>
    );
  }

  return (
    <div className="contents">
      <ClientControlAction
        icon={<Pencil size={15} />}
        label="Edit client"
        onClick={openEdit}
      />

      {profile.canManageLifecycle && !profile.archivedAt && (
        <>
          <ClientControlAction
            icon={<UserRoundSearch size={15} />}
            label="Merge duplicate"
            onClick={openMerge}
          />
          <ClientControlAction
            icon={<Archive size={15} />}
            label="Archive client"
            tone="danger"
            onClick={() => {
              setLifecycleError(null);
              setConfirmAction('archive');
            }}
          />
        </>
      )}

      {profile.canManageLifecycle && profile.archivedAt && (
        <>
          <ClientControlAction
            icon={<ArchiveRestore size={15} />}
            label="Restore client"
            onClick={() => {
              setLifecycleError(null);
              setConfirmAction('restore');
            }}
          />
          {profile.canPermanentlyDelete && (
            <ClientControlAction
              icon={<Trash2 size={15} />}
              label="Delete permanently"
              tone="danger"
              onClick={() => {
                setLifecycleError(null);
                setConfirmAction('delete');
              }}
            />
          )}
        </>
      )}

      <DialogShell
        isOpen={dialog === 'edit'}
        onClose={closeEdit}
        closeOnBackdrop={!editBusy}
        closeOnEscape={!editBusy}
        maxWidthClassName="max-w-xl"
        alignClassName="items-end justify-center p-0 sm:items-center sm:p-4"
        contentClassName="max-h-[calc(100dvh-0.5rem)] touch-pan-y overflow-y-auto overscroll-contain rounded-t-3xl bg-white p-5 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-3xl sm:p-6"
      >
        <div role="dialog" aria-modal="true" aria-labelledby="edit-client-title" className="min-w-0">
          <h2 id="edit-client-title" className="text-lg font-semibold text-stone-950">Edit client</h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Contact changes apply to future messages and reminders. Historical destinations and
            receipts stay unchanged.
          </p>

          <form className="mt-5 space-y-4" onSubmit={event => void submitEdit(event)}>
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="min-w-0 text-sm font-medium text-stone-700">
                First name
                <input
                  name="firstName"
                  autoComplete="given-name"
                  value={editDraft.firstName}
                  onChange={event => setEditDraft(current => ({
                    ...current,
                    firstName: event.target.value,
                  }))}
                  className={INPUT_CLASS_NAME}
                />
              </label>
              <label className="min-w-0 text-sm font-medium text-stone-700">
                Last name
                <input
                  name="lastName"
                  autoComplete="family-name"
                  value={editDraft.lastName}
                  onChange={event => setEditDraft(current => ({
                    ...current,
                    lastName: event.target.value,
                  }))}
                  className={INPUT_CLASS_NAME}
                />
              </label>
            </div>

            <label className="block min-w-0 text-sm font-medium text-stone-700">
              Phone number
              <input
                name="phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                value={editDraft.phone}
                onChange={event => setEditDraft(current => ({
                  ...current,
                  phone: event.target.value,
                }))}
                className={INPUT_CLASS_NAME}
              />
            </label>

            <label className="block min-w-0 text-sm font-medium text-stone-700">
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                value={editDraft.email}
                onChange={event => setEditDraft(current => ({
                  ...current,
                  email: event.target.value,
                }))}
                className={INPUT_CLASS_NAME}
              />
            </label>

            <label className="block min-w-0 text-sm font-medium text-stone-700">
              Birthday
              <input
                name="birthday"
                type="date"
                value={editDraft.birthday}
                onChange={event => setEditDraft(current => ({
                  ...current,
                  birthday: event.target.value,
                }))}
                className={INPUT_CLASS_NAME}
              />
            </label>

            <div className="rounded-2xl bg-stone-50 p-3 text-xs leading-5 text-stone-600">
              This changes the salon profile only. Client sign-in or external authentication
              identities are not silently changed.
            </div>

            {editError && (
              <div role="alert" className="min-w-0 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="break-words font-medium">{editError}</p>
                {possibleDuplicate && (
                  <>
                    <div className="mt-3 rounded-xl bg-white/70 p-3">
                      <p className="break-words font-semibold">{displayName(possibleDuplicate)}</p>
                      <p className="mt-1 break-words text-xs">
                        {possibleDuplicate.phone || 'No phone'}
                        {possibleDuplicate.email ? ` · ${possibleDuplicate.email}` : ''}
                      </p>
                    </div>
                    <div className={`mt-3 grid grid-cols-1 gap-2 ${
                      profile.canManageLifecycle ? 'sm:grid-cols-2' : ''
                    }`}
                    >
                      <button
                        type="button"
                        className={SECONDARY_BUTTON_CLASS_NAME}
                        onClick={() => {
                          setDialog(null);
                          onViewClient(possibleDuplicate.id);
                        }}
                      >
                        View existing client
                      </button>
                      {profile.canManageLifecycle && (
                        <button
                          type="button"
                          className={PRIMARY_BUTTON_CLASS_NAME}
                          onClick={startMergeFromDuplicateWarning}
                        >
                          Merge profiles
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                className={SECONDARY_BUTTON_CLASS_NAME}
                disabled={editBusy}
                onClick={closeEdit}
              >
                Cancel
              </button>
              <button type="submit" className={PRIMARY_BUTTON_CLASS_NAME} disabled={editBusy}>
                {editBusy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      </DialogShell>

      <DialogShell
        isOpen={dialog === 'merge' && !mergeConfirmOpen}
        onClose={closeMerge}
        closeOnBackdrop={!mergeBusy && !mergePreviewBusy}
        closeOnEscape={!mergeBusy && !mergePreviewBusy}
        maxWidthClassName="max-w-3xl"
        alignClassName="items-end justify-center p-0 sm:items-center sm:p-4"
        contentClassName="max-h-[calc(100dvh-0.5rem)] touch-pan-y overflow-y-auto overscroll-contain rounded-t-3xl bg-white p-5 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-3xl sm:p-6"
      >
        <div role="dialog" aria-modal="true" aria-labelledby="merge-client-title" className="min-w-0">
          <h2 id="merge-client-title" className="text-lg font-semibold text-stone-950">Merge duplicate</h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Keep this profile&apos;s stable ID and move the duplicate&apos;s supported history into
            it. This cannot be casually undone.
          </p>

          {!mergePreview && (
            <>
              <div className="mt-5">
                <ProfileSummaryCard eyebrow="Keep this profile" client={currentCandidate} />
              </div>
              <form className="mt-5 min-w-0" onSubmit={event => void searchClients(event)}>
                <label
                  htmlFor="merge-duplicate-search"
                  className="block text-sm font-medium text-stone-700"
                >
                  Find the duplicate
                </label>
                <div className="mt-1 flex min-w-0 flex-col gap-2 sm:flex-row">
                  <input
                    id="merge-duplicate-search"
                    value={mergeQuery}
                    onChange={event => setMergeQuery(event.target.value)}
                    placeholder="Name, phone number, or email"
                    className={`${INPUT_CLASS_NAME} mt-0`}
                  />
                  <button
                    type="submit"
                    disabled={mergeSearchBusy}
                    className={`${PRIMARY_BUTTON_CLASS_NAME} flex shrink-0 items-center justify-center gap-2 sm:px-5`}
                  >
                    {mergeSearchBusy
                      ? <LoaderCircle size={16} className="animate-spin" />
                      : <Search size={16} />}
                    Search
                  </button>
                </div>
              </form>

              {mergeSearchError && (
                <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                  {mergeSearchError}
                </p>
              )}

              {mergeResults.length > 0 && (
                <div className="mt-4 space-y-2" aria-label="Matching clients">
                  {mergeResults.map(candidate => (
                    <button
                      key={candidate.id}
                      type="button"
                      className="flex min-h-14 w-full min-w-0 flex-col rounded-2xl border border-stone-200 bg-white p-3 text-left transition hover:border-rose-300 active:scale-[0.99]"
                      onClick={() => void loadMergePreview(candidate)}
                    >
                      <span className="break-words text-sm font-semibold text-stone-900">
                        {displayName(candidate)}
                      </span>
                      <span className="mt-1 break-all text-xs text-stone-600">
                        {[candidate.phone, candidate.email].filter(Boolean).join(' · ') || 'No contact details'}
                      </span>
                      {candidate.archivedAt && (
                        <span className="mt-1 text-xs font-semibold text-amber-700">
                          Archived profile
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {mergePreviewBusy && (
            <div className="mt-6 flex min-h-28 items-center justify-center gap-2 rounded-2xl bg-stone-50 text-sm font-medium text-stone-600">
              <LoaderCircle size={18} className="animate-spin" />
              Loading merge preview…
            </div>
          )}

          {mergeError && (
            <p role="alert" className="mt-4 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-800">
              {mergeError}
            </p>
          )}

          {mergePreview && !mergePreviewBusy && (
            <div className="mt-5 min-w-0 space-y-5">
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <ProfileSummaryCard eyebrow="Keep this profile" client={mergePreview.primary} />
                <ProfileSummaryCard eyebrow="Merge this duplicate" client={mergePreview.duplicate} />
              </div>

              <section className="min-w-0">
                <h3 className="text-sm font-semibold text-stone-900">Records that will be preserved</h3>
                {mergePreview.counts.length > 0
                  ? (
                      <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {mergePreview.counts.map(item => (
                          <div key={item.key} className="min-w-0 rounded-xl bg-stone-50 p-3">
                            <p className="break-words text-xs font-medium text-stone-600">{item.label}</p>
                            <p className="mt-1 text-lg font-semibold text-stone-950">
                              {item.key.toLowerCase().endsWith('cents')
                                ? formatMoney(item.count, currency)
                                : item.count}
                            </p>
                          </div>
                        ))}
                      </div>
                    )
                  : (
                      <p className="mt-2 rounded-xl bg-stone-50 p-3 text-sm text-stone-600">
                        The server reported no movable records for this preview.
                      </p>
                    )}
              </section>

              <section className="min-w-0">
                <h3 className="text-sm font-semibold text-stone-900">Conflicting values</h3>
                {mergePreview.conflicts.length > 0
                  ? (
                      <div className="mt-2 space-y-3">
                        {mergePreview.conflicts.map(conflict => (
                          <fieldset key={conflict.key} className="min-w-0 rounded-2xl border border-stone-200 p-3">
                            <legend className="px-1 text-sm font-semibold text-stone-900">
                              {conflict.label}
                            </legend>
                            <div className="mt-1 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                              {(['primary', 'duplicate'] as const).map((source) => {
                                const selected = fieldSelections[conflict.key] === source;
                                const value = source === 'primary'
                                  ? conflict.primaryValue
                                  : conflict.duplicateValue;
                                return (
                                  <label
                                    key={source}
                                    className={`flex min-w-0 cursor-pointer gap-3 rounded-xl border p-3 ${
                                      selected
                                        ? 'border-rose-400 bg-rose-50'
                                        : 'border-stone-200 bg-white'
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name={`merge-${conflict.key}`}
                                      checked={selected}
                                      onChange={() => setFieldSelections(current => ({
                                        ...current,
                                        [conflict.key]: source,
                                      }))}
                                      className="mt-0.5 size-4 shrink-0 accent-rose-600"
                                    />
                                    <span className="min-w-0">
                                      <span className="block text-xs font-bold uppercase tracking-wide text-stone-500">
                                        {source === 'primary' ? 'Keep this profile' : 'Merge this duplicate'}
                                      </span>
                                      <span className="mt-1 block break-words text-sm text-stone-900">
                                        {displayValue(value)}
                                      </span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </fieldset>
                        ))}
                      </div>
                    )
                  : (
                      <p className="mt-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
                        No conflicting contact fields or preferences were reported.
                      </p>
                    )}
              </section>

              <div className="rounded-2xl bg-amber-50 p-4 text-xs leading-5 text-amber-950">
                Appointments, payments, communications, rewards, reviews, notes, photos, and other
                linked history remain server-managed. Blocking and important flags are preserved
                and are never weakened automatically. Client sign-in or external authentication
                identities are not merged by this action.
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  className={SECONDARY_BUTTON_CLASS_NAME}
                  onClick={() => {
                    setMergePreview(null);
                    setMergeError(null);
                  }}
                >
                  Choose a different client
                </button>
                <button
                  type="button"
                  className={PRIMARY_BUTTON_CLASS_NAME}
                  onClick={() => {
                    setMergeAcknowledged(false);
                    setMergeConfirmOpen(true);
                  }}
                >
                  Review merge
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={mergeBusy || mergePreviewBusy}
            className="mt-4 min-h-11 w-full rounded-xl text-sm font-semibold text-stone-600 disabled:opacity-50"
            onClick={closeMerge}
          >
            Cancel
          </button>
        </div>
      </DialogShell>

      <DialogShell
        isOpen={mergeConfirmOpen}
        onClose={() => {
          if (!mergeBusy) {
            setMergeConfirmOpen(false);
            setMergeAcknowledged(false);
          }
        }}
        closeOnBackdrop={!mergeBusy}
        closeOnEscape={!mergeBusy}
        maxWidthClassName="max-w-md"
        contentClassName="max-h-[calc(100dvh-2rem)] touch-pan-y overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 shadow-2xl"
      >
        <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-merge-title" className="min-w-0">
          <h2 id="confirm-merge-title" className="text-lg font-semibold text-stone-950">
            Confirm merge
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            {mergePreview
              ? (
                  <>
                    <span>Keep </span>
                    <strong>{displayName(mergePreview.primary)}</strong>
                    <span> and merge </span>
                    <strong>{displayName(mergePreview.duplicate)}</strong>
                    <span> into it. The duplicate will no longer appear as an active profile.</span>
                  </>
                )
              : 'Review both profiles before confirming.'}
          </p>
          <label className="mt-4 flex min-w-0 cursor-pointer gap-3 rounded-2xl border border-stone-200 p-4 text-sm text-stone-800">
            <input
              type="checkbox"
              checked={mergeAcknowledged}
              onChange={event => setMergeAcknowledged(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-rose-600"
            />
            <span className="min-w-0 break-words">
              I checked the primary and duplicate profiles and understand this merge cannot be
              casually undone.
            </span>
          </label>
          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              className={SECONDARY_BUTTON_CLASS_NAME}
              disabled={mergeBusy}
              onClick={() => {
                setMergeConfirmOpen(false);
                setMergeAcknowledged(false);
              }}
            >
              Go back
            </button>
            <button
              type="button"
              className={PRIMARY_BUTTON_CLASS_NAME}
              disabled={!mergeAcknowledged || mergeBusy}
              onClick={() => void submitMerge()}
            >
              {mergeBusy ? 'Merging…' : 'Confirm merge'}
            </button>
          </div>
        </div>
      </DialogShell>

      <ConfirmDialog
        isOpen={confirmAction === 'archive'}
        title="Archive client?"
        description="The client will leave the active directory. Their history and reporting records will remain available, and an owner or admin can restore the profile."
        confirmLabel="Archive client"
        tone="danger"
        busy={lifecycleBusy}
        onClose={() => {
          if (!lifecycleBusy) {
            setConfirmAction(null);
            setLifecycleError(null);
          }
        }}
        onConfirm={() => void runLifecycleAction()}
      >
        {lifecycleError && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
            {lifecycleError}
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={confirmAction === 'restore'}
        title="Restore client?"
        description="The client will return to the active directory. Existing history remains unchanged."
        confirmLabel="Restore client"
        busy={lifecycleBusy}
        onClose={() => {
          if (!lifecycleBusy) {
            setConfirmAction(null);
            setLifecycleError(null);
          }
        }}
        onConfirm={() => void runLifecycleAction()}
      >
        {lifecycleError && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
            {lifecycleError}
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={confirmAction === 'delete'}
        title="Delete this empty profile permanently?"
        description="Only empty profiles are eligible. This removes the client profile and cannot be undone."
        confirmLabel="Delete permanently"
        tone="danger"
        busy={lifecycleBusy}
        onClose={() => {
          if (!lifecycleBusy) {
            setConfirmAction(null);
            setLifecycleError(null);
          }
        }}
        onConfirm={() => void runLifecycleAction()}
      >
        {lifecycleError && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
            {lifecycleError}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
