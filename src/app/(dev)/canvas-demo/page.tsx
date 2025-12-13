'use client';

import React, { useState } from 'react';

import { canTransition } from '@/core/appointments/appointmentStateMachine';
import { resolveEffectivePolicy } from '@/core/appointments/policyResolver';
import type {
  AppointmentState,
  PhotoRequirementMode,
  Transition,
} from '@/core/appointments/policyTypes';
import { CanvasRenderer } from '@/core/canvas/CanvasRenderer';
import type {
  SalonCanvasLocks,
  SuperAdminCanvasLocks,
  TechCanvasConfig,
} from '@/core/canvas/configTypes';
import type { CanvasState } from '@/core/canvas/constants';
import type { ModuleId } from '@/core/canvas/modules';
import { resolveEffectiveConfig } from '@/core/canvas/resolveEffectiveConfig';
import { type TemplateId, TEMPLATES } from '@/core/canvas/templates';

export default function CanvasDemoPage() {
  // Canvas config state (Step 6)
  const [templateId, setTemplateId] = useState<TemplateId>('zen_master');

  const [techEnableMoneyTicker, setTechEnableMoneyTicker] = useState(false);
  const [techDisableStepChecklist, setTechDisableStepChecklist] = useState(false);

  const [salonForceEnableVoiceOrb, setSalonForceEnableVoiceOrb] = useState(false);
  const [salonForceDisableSmartUpsell, setSalonForceDisableSmartUpsell] = useState(false);

  const [superAdminForceDisableMoneyTicker, setSuperAdminForceDisableMoneyTicker] = useState(false);
  const [superAdminForceEnableGapFiller, setSuperAdminForceEnableGapFiller] = useState(false);

  // Appointment state (Step 8)
  const [appointmentState, setAppointmentState] = useState<AppointmentState>('waiting');
  const [beforePhotoUploaded, setBeforePhotoUploaded] = useState(false);
  const [afterPhotoUploaded, setAfterPhotoUploaded] = useState(false);

  // Photo policy state
  const [sa_requireBeforePhotoToStart, setSaRequireBeforePhotoToStart] = useState<PhotoRequirementMode>('off');
  const [sa_requireAfterPhotoToFinish, setSaRequireAfterPhotoToFinish] = useState<PhotoRequirementMode>('off');
  const [sa_requireAfterPhotoToPay, setSaRequireAfterPhotoToPay] = useState<PhotoRequirementMode>('off');

  const [salon_requireBeforePhotoToStart, setSalonRequireBeforePhotoToStart] = useState<PhotoRequirementMode>('off');
  const [salon_requireAfterPhotoToFinish, setSalonRequireAfterPhotoToFinish] = useState<PhotoRequirementMode>('off');
  const [salon_requireAfterPhotoToPay, setSalonRequireAfterPhotoToPay] = useState<PhotoRequirementMode>('off');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalReason, setModalReason] = useState('');

  // Canvas config resolution
  const enabledOverrides: ModuleId[] = [];
  const disabledOverrides: ModuleId[] = [];

  if (techEnableMoneyTicker) {
    enabledOverrides.push('money_ticker');
  }
  if (techDisableStepChecklist) {
    disabledOverrides.push('step_checklist');
  }

  const tech: TechCanvasConfig = {
    techId: 'demo',
    templateId,
    enabledOverrides,
    disabledOverrides,
  };

  const salonLocks: SalonCanvasLocks = {
    forceEnabled: salonForceEnableVoiceOrb ? ['voice_orb'] : [],
    forceDisabled: salonForceDisableSmartUpsell ? ['smart_upsell'] : [],
  };

  const superAdminLocks: SuperAdminCanvasLocks = {
    forceEnabled: superAdminForceEnableGapFiller ? ['gap_filler'] : [],
    forceDisabled: superAdminForceDisableMoneyTicker ? ['money_ticker'] : [],
  };

  const effective = resolveEffectiveConfig({ tech, salonLocks, superAdminLocks });

  // Policy resolution
  const superAdminPolicy = {
    requireBeforePhotoToStart: sa_requireBeforePhotoToStart,
    requireAfterPhotoToFinish: sa_requireAfterPhotoToFinish,
    requireAfterPhotoToPay: sa_requireAfterPhotoToPay,
  };

  const salonPolicy = {
    requireBeforePhotoToStart: salon_requireBeforePhotoToStart,
    requireAfterPhotoToFinish: salon_requireAfterPhotoToFinish,
    requireAfterPhotoToPay: salon_requireAfterPhotoToPay,
    autoPostEnabled: false,
    autoPostPlatforms: [] as Array<'instagram' | 'facebook' | 'tiktok'>,
    autoPostIncludePrice: false,
    autoPostIncludeColor: false,
    autoPostIncludeBrand: false,
    autoPostAIcaptionEnabled: false,
  };

  const effectivePolicy = resolveEffectivePolicy({
    superAdmin: superAdminPolicy,
    salon: salonPolicy,
  });

  const artifacts = {
    beforePhotoUploaded,
    afterPhotoUploaded,
  };

  // Transition handler
  const attemptTransition = (to: AppointmentState) => {
    const transition = { from: appointmentState, to } as Transition;
    const result = canTransition({ transition, policy: effectivePolicy, artifacts });

    if (result.allowed) {
      setAppointmentState(to);
    } else {
      setModalReason(result.reason || 'unknown_reason');
      setModalOpen(true);
    }
  };

  const handleSimulateUpload = () => {
    if (modalReason.includes('before_photo')) {
      setBeforePhotoUploaded(true);
    }
    if (modalReason.includes('after_photo')) {
      setAfterPhotoUploaded(true);
    }
    setModalOpen(false);
  };

  const resetAppointment = () => {
    setAppointmentState('waiting');
    setBeforePhotoUploaded(false);
    setAfterPhotoUploaded(false);
  };

  // Canvas state binding
  const canvasState: CanvasState
    = appointmentState === 'waiting' || appointmentState === 'working' || appointmentState === 'wrap_up'
      ? appointmentState
      : 'wrap_up';

  const isTerminal = appointmentState === 'complete' || appointmentState === 'cancelled' || appointmentState === 'no_show';

  const photoModeOptions: PhotoRequirementMode[] = ['off', 'optional', 'required'];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <div style={{ width: 360, padding: 16, borderRight: '1px solid #ccc', overflowY: 'auto' }}>
        <h2>Canvas Demo Controls</h2>

        {/* Group A: Canvas Configuration */}
        <fieldset style={{ marginBottom: 16 }}>
          <legend>Canvas Configuration</legend>

          <div style={{ marginBottom: 12 }}>
            <label>
              Template:
              <select
                value={templateId}
                onChange={e => setTemplateId(e.target.value as TemplateId)}
                style={{ marginLeft: 8 }}
              >
                {Object.keys(TEMPLATES).map(id => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ marginBottom: 12 }}>
            <strong>Tech Overrides</strong>
            <label style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={techEnableMoneyTicker}
                onChange={e => setTechEnableMoneyTicker(e.target.checked)}
              />
              Enable money_ticker
            </label>
            <label style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={techDisableStepChecklist}
                onChange={e => setTechDisableStepChecklist(e.target.checked)}
              />
              Disable step_checklist
            </label>
          </div>

          <div style={{ marginBottom: 12 }}>
            <strong>Salon Locks</strong>
            <label style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={salonForceEnableVoiceOrb}
                onChange={e => setSalonForceEnableVoiceOrb(e.target.checked)}
              />
              Force enable voice_orb
            </label>
            <label style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={salonForceDisableSmartUpsell}
                onChange={e => setSalonForceDisableSmartUpsell(e.target.checked)}
              />
              Force disable smart_upsell
            </label>
          </div>

          <div style={{ marginBottom: 12 }}>
            <strong>Super Admin Locks</strong>
            <label style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={superAdminForceDisableMoneyTicker}
                onChange={e => setSuperAdminForceDisableMoneyTicker(e.target.checked)}
              />
              Force disable money_ticker
            </label>
            <label style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={superAdminForceEnableGapFiller}
                onChange={e => setSuperAdminForceEnableGapFiller(e.target.checked)}
              />
              Force enable gap_filler
            </label>
          </div>
        </fieldset>

        {/* Group B: Appointment Simulator */}
        <fieldset style={{ marginBottom: 16 }}>
          <legend>Appointment Simulator</legend>

          <div style={{ marginBottom: 12 }}>
            <span
              style={{
                display: 'inline-block',
                padding: '4px 12px',
                borderRadius: 4,
                background: isTerminal ? '#666' : '#007bff',
                color: '#fff',
                fontWeight: 'bold',
              }}
            >
              {appointmentState}
            </span>
          </div>

          <div style={{ marginBottom: 12 }}>
            <strong>Artifacts</strong>
            <label style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={beforePhotoUploaded}
                onChange={e => setBeforePhotoUploaded(e.target.checked)}
              />
              Before Photo Uploaded
            </label>
            <label style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={afterPhotoUploaded}
                onChange={e => setAfterPhotoUploaded(e.target.checked)}
              />
              After Photo Uploaded
            </label>
          </div>

          <div style={{ marginBottom: 12 }}>
            <strong>Actions</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              <button
                onClick={() => attemptTransition('working')}
                disabled={appointmentState !== 'waiting'}
                style={{ padding: '6px 12px' }}
              >
                Start Service
              </button>
              <button
                onClick={() => attemptTransition('wrap_up')}
                disabled={appointmentState !== 'working'}
                style={{ padding: '6px 12px' }}
              >
                Finish Service
              </button>
              <button
                onClick={() => attemptTransition('complete')}
                disabled={appointmentState !== 'wrap_up'}
                style={{ padding: '6px 12px' }}
              >
                Complete & Pay
              </button>
              <button
                onClick={() => attemptTransition('cancelled')}
                disabled={isTerminal}
                style={{ padding: '6px 12px' }}
              >
                Cancel
              </button>
              <button
                onClick={resetAppointment}
                style={{ padding: '6px 12px' }}
              >
                Reset
              </button>
            </div>
          </div>

          {isTerminal && (
            <div
              style={{
                padding: 12,
                background: appointmentState === 'complete' ? '#d4edda' : '#f8d7da',
                borderRadius: 4,
                textAlign: 'center',
              }}
            >
              Appointment
              {' '}
              {appointmentState}
            </div>
          )}
        </fieldset>

        {/* Group C: Policy Simulator */}
        <fieldset style={{ marginBottom: 16 }}>
          <legend>Policy Simulator</legend>

          <div style={{ marginBottom: 12 }}>
            <strong>Super Admin Policy</strong>
            <div style={{ marginTop: 4 }}>
              <label style={{ display: 'block', marginBottom: 4 }}>
                Before Photo to Start:
                <select
                  value={sa_requireBeforePhotoToStart}
                  onChange={e => setSaRequireBeforePhotoToStart(e.target.value as PhotoRequirementMode)}
                  style={{ marginLeft: 8 }}
                >
                  {photoModeOptions.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'block', marginBottom: 4 }}>
                After Photo to Finish:
                <select
                  value={sa_requireAfterPhotoToFinish}
                  onChange={e => setSaRequireAfterPhotoToFinish(e.target.value as PhotoRequirementMode)}
                  style={{ marginLeft: 8 }}
                >
                  {photoModeOptions.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'block', marginBottom: 4 }}>
                After Photo to Pay:
                <select
                  value={sa_requireAfterPhotoToPay}
                  onChange={e => setSaRequireAfterPhotoToPay(e.target.value as PhotoRequirementMode)}
                  style={{ marginLeft: 8 }}
                >
                  {photoModeOptions.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <strong>Salon Policy</strong>
            <div style={{ marginTop: 4 }}>
              <label style={{ display: 'block', marginBottom: 4 }}>
                Before Photo to Start:
                <select
                  value={salon_requireBeforePhotoToStart}
                  onChange={e => setSalonRequireBeforePhotoToStart(e.target.value as PhotoRequirementMode)}
                  style={{ marginLeft: 8 }}
                >
                  {photoModeOptions.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'block', marginBottom: 4 }}>
                After Photo to Finish:
                <select
                  value={salon_requireAfterPhotoToFinish}
                  onChange={e => setSalonRequireAfterPhotoToFinish(e.target.value as PhotoRequirementMode)}
                  style={{ marginLeft: 8 }}
                >
                  {photoModeOptions.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'block', marginBottom: 4 }}>
                After Photo to Pay:
                <select
                  value={salon_requireAfterPhotoToPay}
                  onChange={e => setSalonRequireAfterPhotoToPay(e.target.value as PhotoRequirementMode)}
                  style={{ marginLeft: 8 }}
                >
                  {photoModeOptions.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </fieldset>

        <div style={{ marginTop: 24, padding: 8, background: '#f5f5f5', fontSize: 12 }}>
          <strong>Resolved Canvas Config:</strong>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(effective, null, 2)}
          </pre>
        </div>

        <div style={{ marginTop: 12, padding: 8, background: '#f5f5f5', fontSize: 12 }}>
          <strong>Effective Policy:</strong>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(effectivePolicy, null, 2)}
          </pre>
        </div>
      </div>

      <div style={{ flex: 1, padding: 16 }}>
        <h2>
          Canvas Output (state:
          {canvasState}
          )
        </h2>
        <CanvasRenderer
          state={canvasState}
          enabledModules={effective.enabledModules}
          blockedModules={effective.blockedModules}
          templateId={effective.templateId}
        />
      </div>

      {/* Modal */}
      {modalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#fff',
              padding: 24,
              borderRadius: 8,
              maxWidth: 400,
              width: '90%',
            }}
          >
            <h3 style={{ marginTop: 0 }}>Action Blocked</h3>
            <p>
              <strong>Reason:</strong>
              {' '}
              {modalReason}
            </p>
            <p>
              {modalReason.includes('before_photo') && 'A before photo is required to start the service.'}
              {modalReason.includes('after_photo') && 'An after photo is required to complete the appointment.'}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                onClick={handleSimulateUpload}
                style={{ padding: '8px 16px', background: '#007bff', color: '#fff', border: 'none', borderRadius: 4 }}
              >
                Simulate Upload Photo
              </button>
              <button
                onClick={() => setModalOpen(false)}
                style={{ padding: '8px 16px', background: '#ccc', border: 'none', borderRadius: 4 }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
