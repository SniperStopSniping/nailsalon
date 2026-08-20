'use client';

/**
 * Luster L1 PR6 — owner catalog configuration: capabilities and technician
 * skill assignment (F).
 *
 * Human-readable skill names only. `capability.id` / `technicianCapability.id`
 * exist in the fetched payloads (CRUD needs them) but are used only as React
 * keys and request targets here — never rendered as visible text.
 */

import { Loader2, Plus, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DialogShell } from '@/components/ui/dialog-shell';
import type { CapabilityResponse, TechnicianCapabilityResponse } from '@/types/admin';

import { extractApiError, type TechnicianOption } from './shared';

type CapabilitiesPanelProps = {
  salonSlug: string;
  capabilities: CapabilityResponse[];
  assignments: TechnicianCapabilityResponse[];
  technicians: TechnicianOption[];
  onRefresh: () => void;
};

const DIALOG_ALIGN = 'items-end justify-center p-4 sm:items-center';
const DIALOG_CONTENT = 'max-h-[90dvh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl';

function CapabilityFormDialog({
  salonSlug,
  capability,
  onClose,
  onSaved,
}: {
  salonSlug: string;
  capability: CapabilityResponse | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = capability !== null;
  const [name, setName] = useState(capability?.name ?? '');
  const [description, setDescription] = useState(capability?.description ?? '');
  const [isActive, setIsActive] = useState(capability?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);

  const handleSubmit = async () => {
    if (submitInFlightRef.current) {
      return;
    }
    if (!name.trim()) {
      setError('Skill name is required.');
      return;
    }
    submitInFlightRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        isEdit ? `/api/salon/capabilities/${encodeURIComponent(capability.id)}` : '/api/salon/capabilities',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            salonSlug,
            name: name.trim(),
            description: description.trim() || null,
            isActive,
          }),
        },
      );
      if (!response.ok) {
        setError(await extractApiError(response, 'This skill could not be saved. Try again.'));
        return;
      }
      onSaved();
    } catch {
      setError('We could not save this skill. Check your connection and try again.');
    } finally {
      setSaving(false);
      submitInFlightRef.current = false;
    }
  };

  return (
    <DialogShell
      isOpen
      onClose={saving ? () => {} : onClose}
      closeOnBackdrop={!saving}
      closeOnEscape={!saving}
      maxWidthClassName="max-w-sm"
      contentClassName={DIALOG_CONTENT}
      alignClassName={DIALOG_ALIGN}
    >
      <div className="space-y-4" data-testid="capability-form-dialog">
        <h2 className="text-xl font-semibold text-[#1C1C1E]">{isEdit ? 'Edit skill' : 'New skill'}</h2>
        <label className="block" htmlFor="capability-name">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Skill name</span>
          <input
            id="capability-name"
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="Advanced nail art"
            disabled={saving}
            className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
          />
        </label>
        <label className="block" htmlFor="capability-description">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Description (optional)</span>
          <textarea
            id="capability-description"
            value={description}
            rows={2}
            onChange={event => setDescription(event.target.value)}
            disabled={saving}
            className="w-full rounded-xl border border-gray-200 p-3 text-sm outline-none transition focus:border-rose-700 disabled:bg-gray-50"
          />
        </label>
        <label className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
          <span className="text-sm font-medium text-[#1C1C1E]">Active</span>
          <input
            type="checkbox"
            checked={isActive}
            onChange={event => setIsActive(event.target.checked)}
            disabled={saving}
            className="size-4"
          />
        </label>
        {error && (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="brandSoft" size="pillSm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" variant="brand" size="pillSm" onClick={() => void handleSubmit()} disabled={saving} data-testid="capability-save">
            {saving
              ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Saving…
                  </>
                )
              : isEdit ? 'Save skill' : 'Create skill'}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}

function CapabilityAssignmentRow({
  salonSlug,
  capability,
  assignedTechnicians,
  availableTechnicians,
  onRefresh,
}: {
  salonSlug: string;
  capability: CapabilityResponse;
  assignedTechnicians: Array<{ assignmentId: string; technician: TechnicianOption }>;
  availableTechnicians: TechnicianOption[];
  onRefresh: () => void;
}) {
  const [pickedTechnicianId, setPickedTechnicianId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitInFlightRef = useRef(false);

  const handleAssign = async () => {
    if (submitInFlightRef.current || !pickedTechnicianId) {
      return;
    }
    submitInFlightRef.current = true;
    setAssigning(true);
    setError(null);
    try {
      const response = await fetch('/api/salon/technician-capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonSlug, technicianId: pickedTechnicianId, capabilityId: capability.id }),
      });
      if (!response.ok) {
        setError(await extractApiError(response, 'This could not be assigned. Try again.'));
        return;
      }
      setPickedTechnicianId('');
      onRefresh();
    } catch {
      setError('We could not save this assignment. Check your connection and try again.');
    } finally {
      setAssigning(false);
      submitInFlightRef.current = false;
    }
  };

  const handleRemove = async (assignmentId: string) => {
    if (submitInFlightRef.current) {
      return;
    }
    submitInFlightRef.current = true;
    setRemovingId(assignmentId);
    setError(null);
    try {
      const response = await fetch(
        `/api/salon/technician-capabilities/${encodeURIComponent(assignmentId)}?salonSlug=${encodeURIComponent(salonSlug)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        setError(await extractApiError(response, 'This could not be removed. Try again.'));
        return;
      }
      onRefresh();
    } catch {
      setError('We could not remove this assignment. Check your connection and try again.');
    } finally {
      setRemovingId(null);
      submitInFlightRef.current = false;
    }
  };

  return (
    <div className="border-t border-gray-100 px-4 py-3" data-testid={`capability-assignments-${capability.id}`}>
      <p className="mb-2 text-[12px] font-medium uppercase text-[#8E8E93]">Technicians with this skill</p>
      {assignedTechnicians.length === 0
        ? <p className="mb-2 text-[13px] text-[#8E8E93]">No technician has this skill yet.</p>
        : (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {assignedTechnicians.map(({ assignmentId, technician }) => (
                <span
                  key={assignmentId}
                  className="flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[12px] text-rose-800"
                >
                  {technician.name}
                  <button
                    type="button"
                    aria-label={`Remove ${technician.name} from ${capability.name}`}
                    onClick={() => void handleRemove(assignmentId)}
                    disabled={removingId === assignmentId}
                    className="rounded-full p-0.5 hover:bg-rose-100"
                  >
                    {removingId === assignmentId ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
                  </button>
                </span>
              ))}
            </div>
          )}
      {availableTechnicians.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`capability-assign-select-${capability.id}`}>
            Assign a technician to
            {' '}
            {capability.name}
          </label>
          <select
            id={`capability-assign-select-${capability.id}`}
            value={pickedTechnicianId}
            onChange={event => setPickedTechnicianId(event.target.value)}
            disabled={assigning}
            className="h-9 flex-1 rounded-lg border border-gray-200 px-2 text-[13px] outline-none focus:border-rose-700 disabled:bg-gray-50"
          >
            <option value="">Add a technician…</option>
            {availableTechnicians.map(technician => (
              <option key={technician.id} value={technician.id}>{technician.name}</option>
            ))}
          </select>
          <Button
            type="button"
            variant="brandSoft"
            size="pillSm"
            onClick={() => void handleAssign()}
            disabled={assigning || !pickedTechnicianId}
            data-testid={`capability-assign-${capability.id}`}
          >
            {assigning ? <Loader2 className="size-4 animate-spin" /> : 'Assign'}
          </Button>
        </div>
      )}
      {error && (
        <div role="alert" className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}

export function CapabilitiesPanel({
  salonSlug,
  capabilities,
  assignments,
  technicians,
  onRefresh,
}: CapabilitiesPanelProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingCapability, setEditingCapability] = useState<CapabilityResponse | null>(null);
  const [deletingCapability, setDeletingCapability] = useState<CapabilityResponse | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const technicianById = new Map(technicians.map(technician => [technician.id, technician]));

  const handleDelete = async () => {
    if (!deletingCapability) {
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const response = await fetch(
        `/api/salon/capabilities/${encodeURIComponent(deletingCapability.id)}?salonSlug=${encodeURIComponent(salonSlug)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        setDeleteError(await extractApiError(response, 'This skill could not be deleted. Try again.'));
        return;
      }
      setDeletingCapability(null);
      onRefresh();
    } catch {
      setDeleteError('We could not delete this skill. Check your connection and try again.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="catalog-capabilities-panel">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-[#1C1C1E]">Capabilities &amp; staff skills</h3>
          <p className="mt-0.5 text-[13px] text-[#6B7280]">
            Define skills (like "Advanced nail art") and say which
            technicians have them.
          </p>
        </div>
        <Button type="button" variant="brandSoft" size="pillSm" onClick={() => setShowCreate(true)} data-testid="capability-create-open">
          <Plus className="mr-1 size-4" />
          New skill
        </Button>
      </div>

      {capabilities.length === 0
        ? (
            <div className="rounded-[18px] border border-gray-200 bg-white p-4 text-[14px] text-[#8E8E93]">
              No skills defined yet. Most salons never need this — add a skill
              only if a service should require a specific technician
              qualification.
            </div>
          )
        : (
            <div className="space-y-3">
              {capabilities.map((capability) => {
                const capabilityAssignments = assignments
                  .filter(assignment => assignment.capabilityId === capability.id)
                  .map(assignment => ({
                    assignmentId: assignment.id,
                    technician: technicianById.get(assignment.technicianId),
                  }))
                  .filter((row): row is { assignmentId: string; technician: TechnicianOption } => Boolean(row.technician));
                const assignedIds = new Set(capabilityAssignments.map(row => row.technician.id));
                const availableTechnicians = technicians.filter(technician => !assignedIds.has(technician.id));

                return (
                  <div key={capability.id} className="overflow-hidden rounded-[18px] border border-gray-100 bg-white" data-testid={`capability-row-${capability.id}`}>
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <span className="block truncate text-[15px] font-semibold text-[#1C1C1E]">{capability.name}</span>
                        {capability.description && (
                          <span className="block truncate text-[12px] text-[#8E8E93]">{capability.description}</span>
                        )}
                        {!capability.isActive && (
                          <span className="mt-1 inline-block rounded-full bg-gray-200 px-2 py-0.5 text-[11px] text-gray-600">Inactive</span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          className="text-[13px] font-medium text-rose-800"
                          onClick={() => setEditingCapability(capability)}
                          data-testid={`capability-edit-${capability.id}`}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${capability.name}`}
                          data-testid={`capability-delete-${capability.id}`}
                          onClick={() => {
                            setDeleteError(null);
                            setDeletingCapability(capability);
                          }}
                          className="rounded-full p-1.5 text-red-600 transition hover:bg-red-50"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    </div>
                    <CapabilityAssignmentRow
                      salonSlug={salonSlug}
                      capability={capability}
                      assignedTechnicians={capabilityAssignments}
                      availableTechnicians={availableTechnicians}
                      onRefresh={onRefresh}
                    />
                  </div>
                );
              })}
            </div>
          )}

      {(showCreate || editingCapability) && (
        <CapabilityFormDialog
          salonSlug={salonSlug}
          capability={editingCapability}
          onClose={() => {
            setShowCreate(false);
            setEditingCapability(null);
          }}
          onSaved={() => {
            setShowCreate(false);
            setEditingCapability(null);
            onRefresh();
          }}
        />
      )}

      <ConfirmDialog
        isOpen={deletingCapability !== null}
        title={`Delete "${deletingCapability?.name ?? ''}"?`}
        description={deleteError ?? 'This cannot be undone. Skills still assigned to a technician or used by a rule cannot be deleted.'}
        confirmLabel="Delete skill"
        tone="danger"
        busy={deleteBusy}
        onConfirm={() => void handleDelete()}
        onClose={() => {
          if (!deleteBusy) {
            setDeletingCapability(null);
            setDeleteError(null);
          }
        }}
      />
    </div>
  );
}
