import type {
  SalonCanvasLocks,
  SuperAdminCanvasLocks,
  TechCanvasConfig,
} from './configTypes';
import type { ModuleId } from './modules';
import type { TemplateId } from './templates';
import { TEMPLATES } from './templates';

export function resolveEffectiveConfig(args: {
  tech: TechCanvasConfig;
  salonLocks?: SalonCanvasLocks;
  superAdminLocks?: SuperAdminCanvasLocks;
}): {
    templateId: TemplateId;
    enabledModules: ModuleId[];
    blockedModules: ModuleId[];
  } {
  const { tech, salonLocks, superAdminLocks } = args;

  const template = TEMPLATES[tech.templateId];
  const enabled = new Set<ModuleId>(template.defaultEnabled);
  const blocked = new Set<ModuleId>(template.defaultBlocked ?? []);

  if (tech.enabledOverrides) {
    for (const id of tech.enabledOverrides) {
      enabled.add(id);
    }
  }
  if (tech.disabledOverrides) {
    for (const id of tech.disabledOverrides) {
      enabled.delete(id);
    }
  }

  if (salonLocks?.forceEnabled) {
    for (const id of salonLocks.forceEnabled) {
      enabled.add(id);
    }
  }
  if (salonLocks?.forceDisabled) {
    for (const id of salonLocks.forceDisabled) {
      enabled.delete(id);
      blocked.add(id);
    }
  }

  if (superAdminLocks?.forceEnabled) {
    for (const id of superAdminLocks.forceEnabled) {
      enabled.add(id);
    }
  }
  if (superAdminLocks?.forceDisabled) {
    for (const id of superAdminLocks.forceDisabled) {
      enabled.delete(id);
      blocked.add(id);
    }
  }

  const enabledModules = Array.from(enabled).filter(id => !blocked.has(id));
  const blockedModules = Array.from(blocked);

  return {
    templateId: tech.templateId,
    enabledModules,
    blockedModules,
  };
}
