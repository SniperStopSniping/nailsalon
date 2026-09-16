import 'server-only';

import {
  OWNER_ASSISTANT_TOOL_ARG_SCHEMAS,
  type OwnerAssistantToolName,
} from '../contracts';
import {
  type DiagnoseDayArgs,
  diagnoseDayAvailability,
  DiagnoseDayInvalidArgumentsError,
} from './diagnoseDayAvailability.server';
import { findDestination } from './findDestination.server';
import { getSalonOverview } from './getSalonOverview.server';
import { getSetupReadiness } from './getSetupReadiness.server';
import { listServices } from './listServices.server';

/**
 * The tool dispatcher (docs/OWNER_ASSISTANT_CHAT.md §3.2).
 *
 * NEVER THROWS. Every failure — an unknown name, a name the operator has not
 * enabled, arguments that do not validate, a query that blew up — becomes a
 * small error code that is handed back to the model as a tool result, so the
 * owner sees an honest sentence instead of a stack trace.
 *
 * `salonId` is resolved by the route from the session. Tool arguments can
 * never influence which salon is read.
 */

export type OwnerAssistantToolErrorCode =
  | 'unknown_tool'
  | 'tool_not_enabled'
  | 'invalid_arguments'
  | 'tool_failed';

export type OwnerAssistantToolOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: OwnerAssistantToolErrorCode } };

function isKnownTool(name: string): name is OwnerAssistantToolName {
  return Object.hasOwn(OWNER_ASSISTANT_TOOL_ARG_SCHEMAS, name);
}

export async function executeOwnerAssistantTool(args: {
  name: string;
  argumentsJson: string;
  salonId: string;
  enabledTools: readonly OwnerAssistantToolName[];
  now?: Date;
}): Promise<OwnerAssistantToolOutcome> {
  if (!isKnownTool(args.name)) {
    return { ok: false, error: { code: 'unknown_tool' } };
  }

  if (!args.enabledTools.includes(args.name)) {
    return { ok: false, error: { code: 'tool_not_enabled' } };
  }

  let rawArguments: unknown;
  try {
    rawArguments = args.argumentsJson.trim() === '' ? {} : JSON.parse(args.argumentsJson);
  } catch {
    return { ok: false, error: { code: 'invalid_arguments' } };
  }

  const parsed = OWNER_ASSISTANT_TOOL_ARG_SCHEMAS[args.name].safeParse(rawArguments);
  if (!parsed.success) {
    return { ok: false, error: { code: 'invalid_arguments' } };
  }

  try {
    switch (args.name) {
      case 'get_salon_overview':
        return { ok: true, result: await getSalonOverview(args.salonId, { now: args.now }) };
      case 'list_services':
        return {
          ok: true,
          result: await listServices(args.salonId, parsed.data as { includeInactive: boolean }),
        };
      case 'find_destination':
        return { ok: true, result: findDestination(parsed.data as { query: string }) };
      case 'diagnose_day_availability':
        return {
          ok: true,
          result: await diagnoseDayAvailability(
            args.salonId,
            parsed.data as DiagnoseDayArgs,
            { now: args.now },
          ),
        };
      case 'get_setup_readiness':
        return { ok: true, result: await getSetupReadiness(args.salonId, { now: args.now }) };
      default:
        return { ok: false, error: { code: 'unknown_tool' } };
    }
  } catch (error) {
    // A day the tool cannot honour is an ARGUMENT problem, not a fault: told
    // apart here so the model can ask the owner for a different day instead of
    // reporting that something broke.
    if (error instanceof DiagnoseDayInvalidArgumentsError) {
      return { ok: false, error: { code: 'invalid_arguments' } };
    }

    // A database fault must not become an exception the owner sees, and its
    // message must not become model input.
    return { ok: false, error: { code: 'tool_failed' } };
  }
}
