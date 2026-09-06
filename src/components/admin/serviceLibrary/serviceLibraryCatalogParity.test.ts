/**
 * AG-services-06 — one catalogue behind both service-library pickers.
 *
 * The dashboard Library tab reads `SERVICE_TEMPLATES` directly. The onboarding
 * sheet reads the same catalogue through the lab package's `serviceMenuPort`,
 * whose ids live in their own `labServiceId` namespace and are reconciled by a
 * hand-maintained mapping table. `service-library-connection.test.ts` already
 * proves the production → onboarding direction (every template is offerable in
 * onboarding). This test proves the direction that was missing, and is the one
 * that silently rots: onboarding → production.
 *
 * Every id the onboarding picker can select must resolve to a real production
 * template, so a selection can never land as a `template_key = NULL` row that
 * the dashboard Library then offers again as "not added". The single accepted
 * exception is declared here by name, so adding another `production_gap`
 * requires editing this list rather than happening by accident.
 */

import { getTemplateByKey } from '@/libs/serviceTemplateCatalog';

import { serviceMenuPort } from '../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/integrations/adapters/service-menu';
import {
  ADD_ON_PRODUCTION_MAPPINGS,
  SERVICE_MENU_PRODUCTION_MAPPINGS,
} from '../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/integrations/contracts/service-menu-production-mapping';

/**
 * Onboarding ids that deliberately have no template: the owner must author the
 * service themselves. `production_gap` is the only mapping kind allowed to be
 * unresolvable, and only for these ids.
 */
const ACCEPTED_PRODUCTION_GAPS = new Set(['svc-addon-consultation']);

type Drift = { labServiceId: string; reason: string };

function describeDrift(
  items: readonly { id: string }[],
  mappings: readonly {
    labServiceId: string;
    mappingKind: string;
    productionCanonicalId: string;
  }[],
): Drift[] {
  const drift: Drift[] = [];
  for (const item of items) {
    const mapping = mappings.find(candidate => candidate.labServiceId === item.id);
    if (!mapping) {
      drift.push({ labServiceId: item.id, reason: 'no production mapping' });
      continue;
    }
    if (mapping.mappingKind === 'production_gap') {
      if (!ACCEPTED_PRODUCTION_GAPS.has(item.id)) {
        drift.push({
          labServiceId: item.id,
          reason: 'undeclared production_gap — an owner selection would land without a template key',
        });
      }
      continue;
    }
    if (!getTemplateByKey(mapping.productionCanonicalId)) {
      drift.push({
        labServiceId: item.id,
        reason: `maps to unknown template "${mapping.productionCanonicalId}"`,
      });
    }
  }
  return drift;
}

describe('service library parity — onboarding selections resolve to production templates', () => {
  it('maps every onboarding library service to a template the dashboard Library also offers', () => {
    const services = serviceMenuPort.getLibraryServices();
    const drift = describeDrift(services, SERVICE_MENU_PRODUCTION_MAPPINGS);

    // Guard against a vacuous pass if the port ever returns nothing.
    expect(services.length).toBeGreaterThan(20);
    expect(drift, JSON.stringify(drift, null, 2)).toEqual([]);
  });

  it('maps every onboarding library add-on to a template the dashboard Library also offers', () => {
    const addOns = serviceMenuPort.getLibraryAddOns();
    const drift = describeDrift(addOns, ADD_ON_PRODUCTION_MAPPINGS);

    expect(addOns.length).toBeGreaterThan(4);
    expect(drift, JSON.stringify(drift, null, 2)).toEqual([]);
  });

  it('keeps the default onboarding selection fully mappable', () => {
    // What a salon gets by accepting onboarding unchanged must be exactly what
    // the dashboard can show as "Added".
    const defaults = serviceMenuPort.createDefaultSelection();
    const unmapped = [
      ...defaults.selectedServiceIds.map(id => ({
        id,
        mapping: SERVICE_MENU_PRODUCTION_MAPPINGS.find(item => item.labServiceId === id),
      })),
      ...(defaults.selectedAddOnIds ?? []).map(id => ({
        id,
        mapping: ADD_ON_PRODUCTION_MAPPINGS.find(item => item.labServiceId === id),
      })),
    ].filter(entry => !entry.mapping || !getTemplateByKey(entry.mapping.productionCanonicalId));

    expect(unmapped.map(entry => entry.id)).toEqual([]);
  });

  it('never points two onboarding ids at one exact template', () => {
    // Two ids claiming the same `exact_template` is how near-duplicate menu
    // rows appear after onboarding.
    const exactKeys = SERVICE_MENU_PRODUCTION_MAPPINGS
      .filter(mapping => mapping.mappingKind === 'exact_template')
      .map(mapping => mapping.productionCanonicalId);

    expect(new Set(exactKeys).size).toBe(exactKeys.length);
  });
});
