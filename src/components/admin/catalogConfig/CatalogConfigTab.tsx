'use client';

/**
 * Luster L1 PR6 — the owner-facing "Catalog" tab inside ServicesModal.
 *
 * LEGACY SIMPLICITY (HC1): nothing in this file fetches anything until the
 * owner actually opens this tab (ServicesModal only mounts it when
 * `activeTab === 'catalog'`), and the landing view is a plain overview that
 * requires no action. A salon that never opens this tab is completely
 * unaffected; a salon that opens it and does nothing sees every service
 * listed as "Not grouped" / "Default (today's behavior)" / ungrouped
 * add-ons — never anything auto-created.
 *
 * This component owns ALL data fetching for the tab (services, add-ons,
 * add-on groups, capabilities, technician-capabilities, technicians,
 * catalog rules) so its sibling panels stay presentational and none of them
 * duplicate a fetch ServicesModal itself already made — the L1 fields
 * (`parentServiceId`, `groupId`, `confirmationMode`, …) are not on
 * ServicesModal's own `ServiceData`/`AddOnData` types, so this tab fetches
 * its own, independent, full copies rather than widening those types.
 */

import { useCallback, useEffect, useState } from 'react';

import type {
  AddOnGroupResponse,
  AddOnResponse,
  CapabilityResponse,
  CatalogRuleResponse,
  ServiceResponse,
  TechnicianCapabilityResponse,
} from '@/types/admin';

import { AddOnsAndGroupsPanel } from './AddOnsAndGroupsPanel';
import { BookingConfirmationPanel } from './BookingConfirmationPanel';
import { CapabilitiesPanel } from './CapabilitiesPanel';
import { GroupServicesPanel } from './GroupServicesPanel';
import { PreviewPanel } from './PreviewPanel';
import { RulesPanel } from './RulesPanel';
import type { TechnicianOption } from './shared';

type CatalogConfigTabProps = {
  salonSlug: string | null;
};

type CatalogSection =
  | 'overview'
  | 'addOns'
  | 'groupServices'
  | 'confirmation'
  | 'rules'
  | 'capabilities'
  | 'preview';

const SECTIONS: Array<{ id: CatalogSection; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'addOns', label: 'Add-ons & groups' },
  { id: 'groupServices', label: 'Group services' },
  { id: 'confirmation', label: 'Booking confirmation' },
  { id: 'rules', label: 'Rules' },
  { id: 'capabilities', label: 'Capabilities & staff' },
  { id: 'preview', label: 'Preview & test' },
];

const OVERVIEW_CARDS: Array<{ id: CatalogSection; title: string; description: string }> = [
  {
    id: 'addOns',
    title: 'Add-ons & groups',
    description: 'Let clients choose between related add-ons, and create new add-ons.',
  },
  {
    id: 'groupServices',
    title: 'Group services',
    description: 'Turn related services into variants of one parent service.',
  },
  {
    id: 'confirmation',
    title: 'Booking confirmation',
    description: 'Choose which services need your approval before they’re confirmed.',
  },
  {
    id: 'rules',
    title: 'Rules',
    description: 'Bundle, hide, require, block, or limit add-ons for specific services.',
  },
  {
    id: 'capabilities',
    title: 'Capabilities & staff',
    description: 'Define skills and say which technicians have them.',
  },
  {
    id: 'preview',
    title: 'Preview & test',
    description: 'See exactly what a client would get for a given selection.',
  },
];

type TechnicianApiRow = { id: string; name: string; isActive: boolean };

export function CatalogConfigTab({ salonSlug }: CatalogConfigTabProps) {
  const [section, setSection] = useState<CatalogSection>('overview');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const [services, setServices] = useState<ServiceResponse[]>([]);
  const [addOns, setAddOns] = useState<AddOnResponse[]>([]);
  const [addOnGroups, setAddOnGroups] = useState<AddOnGroupResponse[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityResponse[]>([]);
  const [technicianCapabilities, setTechnicianCapabilities] = useState<TechnicianCapabilityResponse[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [catalogRules, setCatalogRules] = useState<CatalogRuleResponse[]>([]);

  const loadAll = useCallback(async () => {
    if (!salonSlug) {
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const qs = `salonSlug=${encodeURIComponent(salonSlug)}`;
      const [servicesRes, addOnsRes, groupsRes, capsRes, techCapsRes, techRes, rulesRes] = await Promise.all([
        fetch(`/api/salon/services?${qs}`),
        fetch(`/api/salon/add-ons?${qs}`),
        fetch(`/api/salon/add-on-groups?${qs}`),
        fetch(`/api/salon/capabilities?${qs}`),
        fetch(`/api/salon/technician-capabilities?${qs}`),
        fetch(`/api/admin/technicians?${qs}&status=all&limit=100`),
        fetch(`/api/salon/catalog-rules?${qs}`),
      ]);

      if (!servicesRes.ok || !addOnsRes.ok || !groupsRes.ok || !capsRes.ok || !techCapsRes.ok || !techRes.ok || !rulesRes.ok) {
        throw new Error('One or more catalog settings could not be loaded.');
      }

      const [servicesJson, addOnsJson, groupsJson, capsJson, techCapsJson, techJson, rulesJson] = await Promise.all([
        servicesRes.json(),
        addOnsRes.json(),
        groupsRes.json(),
        capsRes.json(),
        techCapsRes.json(),
        techRes.json(),
        rulesRes.json(),
      ]);

      setServices(servicesJson?.data?.services ?? []);
      setAddOns(addOnsJson?.data?.addOns ?? []);
      setAddOnGroups(groupsJson?.data?.groups ?? []);
      setCapabilities(capsJson?.data?.capabilities ?? []);
      setTechnicianCapabilities(techCapsJson?.data?.assignments ?? []);
      setTechnicians((techJson?.data?.technicians ?? []).map((technician: TechnicianApiRow) => ({
        id: technician.id,
        name: technician.name,
        isActive: technician.isActive,
      })));
      setCatalogRules(rulesJson?.data?.rules ?? []);
      setLoadedOnce(true);
    } catch (error) {
      console.error('Failed to load catalog configuration:', error);
      setLoadError('Some catalog settings could not be loaded. Try again.');
    } finally {
      setLoading(false);
    }
  }, [salonSlug]);

  // Only fetch once the owner actually opens this tab (progressive
  // disclosure — HC1) and only once per mount thereafter; panels call
  // `onRefresh` (= `loadAll`) themselves after a successful write.
  useEffect(() => {
    if (section !== 'overview' && !loadedOnce && salonSlug) {
      void loadAll();
    }
  }, [section, loadedOnce, salonSlug, loadAll]);

  if (!salonSlug) {
    return (
      <div className="px-4 py-6 text-sm text-[#8E8E93]" data-testid="catalog-config-tab">
        Select a salon to manage catalog configuration.
      </div>
    );
  }

  return (
    <div className="px-4 pb-10" data-testid="catalog-config-tab">
      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Catalog configuration sections">
        {SECTIONS.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={section === item.id}
            data-testid={`catalog-section-${item.id}`}
            onClick={() => setSection(item.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
              section === item.id ? 'bg-rose-800 text-white' : 'bg-gray-100 text-[#6B7280]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loadError && (
        <div role="alert" className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {loadError}
          <button type="button" className="ml-2 font-semibold underline" onClick={() => void loadAll()}>
            Try again
          </button>
        </div>
      )}

      {section === 'overview' && (
        <div className="space-y-3">
          <p className="text-[13px] leading-relaxed text-[#6B7280]">
            Advanced catalog options for salons with variants, add-on
            groups, or booking rules. Nothing here is required — your menu
            works exactly as it does today until you use one of these.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {OVERVIEW_CARDS.map(card => (
              <button
                key={card.id}
                type="button"
                data-testid={`catalog-overview-${card.id}`}
                onClick={() => setSection(card.id)}
                className="rounded-[18px] border border-gray-200 bg-white p-4 text-left transition hover:border-rose-700"
              >
                <span className="block text-[14px] font-semibold text-[#1C1C1E]">{card.title}</span>
                <span className="mt-1 block text-[12px] text-[#6B7280]">{card.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {section !== 'overview' && loading && !loadedOnce && (
        <div className="rounded-[18px] border border-gray-200 bg-white p-6 text-center text-[13px] text-[#8E8E93]">
          Loading catalog settings…
        </div>
      )}

      {section !== 'overview' && loadedOnce && (
        <>
          {section === 'addOns' && (
            <AddOnsAndGroupsPanel
              salonSlug={salonSlug}
              services={services}
              addOns={addOns}
              addOnGroups={addOnGroups}
              onRefresh={() => void loadAll()}
            />
          )}
          {section === 'groupServices' && (
            <GroupServicesPanel
              salonSlug={salonSlug}
              services={services}
              onRefresh={() => void loadAll()}
            />
          )}
          {section === 'confirmation' && (
            <BookingConfirmationPanel
              salonSlug={salonSlug}
              services={services}
              onRefresh={() => void loadAll()}
            />
          )}
          {section === 'rules' && (
            <RulesPanel
              salonSlug={salonSlug}
              services={services}
              addOns={addOns}
              capabilities={capabilities}
              rules={catalogRules}
              onRefresh={() => void loadAll()}
            />
          )}
          {section === 'capabilities' && (
            <CapabilitiesPanel
              salonSlug={salonSlug}
              capabilities={capabilities}
              assignments={technicianCapabilities}
              technicians={technicians}
              onRefresh={() => void loadAll()}
            />
          )}
          {section === 'preview' && (
            <PreviewPanel
              salonSlug={salonSlug}
              services={services}
              addOns={addOns}
              technicians={technicians}
            />
          )}
        </>
      )}
    </div>
  );
}
