import type {
  AppointmentArtifacts,
  EffectivePolicy,
  PhotoRequirementMode,
  Transition,
  TransitionResult,
} from './policyTypes';

function requires(mode: PhotoRequirementMode): boolean {
  return mode === 'required';
}

export function canTransition(args: {
  transition: Transition;
  policy: EffectivePolicy;
  artifacts: AppointmentArtifacts;
}): TransitionResult {
  const { transition, policy, artifacts } = args;

  // waiting -> working (Start Service)
  // GATE: before photo (if required)
  if (transition.from === 'waiting' && transition.to === 'working') {
    if (requires(policy.requireBeforePhotoToStart) && !artifacts.beforePhotoUploaded) {
      return { allowed: false, reason: 'before_photo_required_to_start' };
    }
    return { allowed: true };
  }

  // working -> wrap_up (Finish service, enter close-out mode)
  // NOTE: do NOT gate here; wrap_up is where after-photo typically happens.
  if (transition.from === 'working' && transition.to === 'wrap_up') {
    return { allowed: true };
  }

  // wrap_up -> complete (Pay & Close)
  // GATE: after photo (if required by either finish or pay)
  if (transition.from === 'wrap_up' && transition.to === 'complete') {
    const strictFinish = requires(policy.requireAfterPhotoToFinish);
    const strictPay = requires(policy.requireAfterPhotoToPay);

    if ((strictFinish || strictPay) && !artifacts.afterPhotoUploaded) {
      return { allowed: false, reason: 'after_photo_required_to_complete' };
    }
    return { allowed: true };
  }

  // cancellations / no-shows (always allowed from non-terminal states)
  if (transition.to === 'cancelled' || transition.to === 'no_show') {
    return { allowed: true };
  }

  return { allowed: false, reason: 'invalid_transition' };
}
