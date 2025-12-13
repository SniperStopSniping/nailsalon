import type { ModuleId } from './modules';
import type { TemplateId } from './templates';

export type TechCanvasConfig = {
  techId: string;
  templateId: TemplateId;
  enabledOverrides?: ModuleId[];
  disabledOverrides?: ModuleId[];
};

export type SalonCanvasLocks = {
  forceEnabled?: ModuleId[];
  forceDisabled?: ModuleId[];
};

export type SuperAdminCanvasLocks = {
  forceEnabled?: ModuleId[];
  forceDisabled?: ModuleId[];
};
