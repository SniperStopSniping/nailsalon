export type AppointmentState =
  | 'waiting'
  | 'working'
  | 'wrap_up'
  | 'complete'
  | 'cancelled'
  | 'no_show';

export type PhotoRequirementMode = 'off' | 'optional' | 'required';

export type SalonPolicy = {
  // photos
  requireBeforePhotoToStart: PhotoRequirementMode; // gate waiting->working
  requireAfterPhotoToFinish: PhotoRequirementMode; // gate wrap_up->complete (finish proof)
  requireAfterPhotoToPay: PhotoRequirementMode; // gate wrap_up->complete (pay proof)

  // posting (future steps)
  autoPostEnabled: boolean;
  autoPostPlatforms: Array<'instagram' | 'facebook' | 'tiktok'>;
  autoPostIncludePrice: boolean;
  autoPostIncludeColor: boolean;
  autoPostIncludeBrand: boolean;
  autoPostAIcaptionEnabled: boolean;
};

export type SuperAdminPolicy = {
  // if set, overrides salon. If undefined, salon decides.
  requireBeforePhotoToStart?: PhotoRequirementMode;
  requireAfterPhotoToFinish?: PhotoRequirementMode;
  requireAfterPhotoToPay?: PhotoRequirementMode;

  // posting plan controls (future)
  autoPostEnabled?: boolean;
  autoPostAIcaptionEnabled?: boolean;
};

export type EffectivePolicy = {} & SalonPolicy;

export type AppointmentArtifacts = {
  beforePhotoUploaded: boolean;
  afterPhotoUploaded: boolean;
};

export type Transition =
  | { from: 'waiting'; to: 'working' }
  | { from: 'working'; to: 'wrap_up' }
  | { from: 'wrap_up'; to: 'complete' }
  | { from: 'waiting' | 'working' | 'wrap_up'; to: 'cancelled' | 'no_show' };

export type TransitionResult = {
  allowed: boolean;
  reason?: string; // short machine-readable message
};
