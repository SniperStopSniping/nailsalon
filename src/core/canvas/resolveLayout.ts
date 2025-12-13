import {
  type CanvasSlot,
  type CanvasState,
  FALLBACK_LAYOUT,
  PROTECTED_SLOTS,
  STATE_SLOTS,
} from './constants';
import { type ModuleId, MODULES } from './modules';

export function resolveLayout(args: {
  state: CanvasState;
  enabledModules: ModuleId[];
  blockedModules?: ModuleId[];
  templateId?: string;
}): Record<CanvasSlot, ModuleId[]> {
  const { state, enabledModules, blockedModules = [], templateId } = args;

  const allowedSlots = STATE_SLOTS[state];
  const slotMap: Record<CanvasSlot, ModuleId[]> = {
    primary_card: [],
    top_overlay: [],
    center_overlay: [],
    bottom_actions: [],
    floating_assist: [],
    focus_anchor: [],
    completion_row: [],
  };

  const protectedSlot = PROTECTED_SLOTS[state];
  let protectedModuleId: ModuleId | null = null;

  for (const moduleId of Object.keys(MODULES) as ModuleId[]) {
    const meta = MODULES[moduleId];
    if (
      meta.priority === 1000
      && meta.allowedStates.includes(state)
      && meta.defaultSlot === protectedSlot
    ) {
      protectedModuleId = moduleId;
      break;
    }
  }

  if (!protectedModuleId) {
    const fallback = FALLBACK_LAYOUT[state];
    for (const slot of Object.keys(fallback) as CanvasSlot[]) {
      const modules = fallback[slot];
      if (modules) {
        slotMap[slot] = modules as ModuleId[];
      }
    }
    return slotMap;
  }

  slotMap[protectedSlot] = [protectedModuleId];

  const blockedSet = new Set(blockedModules);
  const seen = new Set<ModuleId>();
  const candidates: ModuleId[] = [];

  for (const moduleId of enabledModules) {
    if (seen.has(moduleId)) {
      continue;
    }
    seen.add(moduleId);

    if (moduleId === protectedModuleId) {
      continue;
    }
    if (blockedSet.has(moduleId)) {
      continue;
    }

    const meta = MODULES[moduleId];
    if (!meta) {
      continue;
    }
    if (!meta.allowedStates.includes(state)) {
      continue;
    }
    if (templateId && meta.blockedInTemplates?.includes(templateId)) {
      continue;
    }

    candidates.push(moduleId);
  }

  const excluded = new Set<ModuleId>();

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;

      if (excluded.has(a) || excluded.has(b)) {
        continue;
      }

      const metaA = MODULES[a];
      const metaB = MODULES[b];

      const aConflictsB = metaA.conflictsWith?.includes(b) ?? false;
      const bConflictsA = metaB.conflictsWith?.includes(a) ?? false;

      if (aConflictsB || bConflictsA) {
        if (metaA.priority > metaB.priority) {
          excluded.add(b);
        } else if (metaB.priority > metaA.priority) {
          excluded.add(a);
        } else {
          if (a.localeCompare(b) <= 0) {
            excluded.add(b);
          } else {
            excluded.add(a);
          }
        }
      }
    }
  }

  const resolved = candidates.filter(id => !excluded.has(id));

  for (const moduleId of resolved) {
    const meta = MODULES[moduleId];
    const slot = meta.defaultSlot;

    if (!allowedSlots.includes(slot)) {
      continue;
    }
    if (slot === protectedSlot && slotMap[slot].length > 0) {
      continue;
    }
    if (slotMap[slot].includes(moduleId)) {
      continue;
    }

    slotMap[slot].push(moduleId);
  }

  for (const slot of Object.keys(slotMap) as CanvasSlot[]) {
    slotMap[slot].sort((a, b) => {
      const priorityDiff = MODULES[b].priority - MODULES[a].priority;
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return a.localeCompare(b);
    });
  }

  return slotMap;
}
