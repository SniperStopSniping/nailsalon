import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AddOnResponse, CapabilityResponse, CatalogRuleResponse, ServiceResponse } from '@/types/admin';

import { RulesPanel } from './RulesPanel';

const services: ServiceResponse[] = [
  { id: 'svc_long', name: 'Long Nails', price: 6000, durationMinutes: 60, isActive: true },
];

const addOns: AddOnResponse[] = [
  { id: 'addon_removal', name: 'Removal', slug: 'removal', priceCents: 800, durationMinutes: 15, category: 'removal', pricingType: 'fixed', isActive: true },
  { id: 'addon_french', name: 'French Tips', slug: 'french', priceCents: 500, durationMinutes: 10, category: 'nail_art', pricingType: 'fixed', isActive: true },
];

const capabilities: CapabilityResponse[] = [
  { id: 'cap_1', slug: 'advanced-nail-art', name: 'Advanced nail art', description: null, isActive: true },
];

function renderPanel(rules: CatalogRuleResponse[], onRefresh = vi.fn()) {
  render(
    <RulesPanel
      salonSlug="isla-nail-studio"
      services={services}
      addOns={addOns}
      capabilities={capabilities}
      rules={rules}
      onRefresh={onRefresh}
    />,
  );
  return { onRefresh };
}

describe('RulesPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('never shows a generic subject/ruleType/object/params/priority builder — presents an existing rule as a plain sentence with no raw ids', () => {
    const rule: CatalogRuleResponse = {
      id: 'rule_1',
      ruleType: 'include',
      serviceScopeId: null,
      subjectServiceId: 'svc_long',
      subjectAddOnId: null,
      objectAddOnId: 'addon_removal',
      capabilityId: null,
      params: { autoAdd: true },
      priority: 0,
      isActive: true,
      note: null,
    };
    renderPanel([rule]);

    expect(screen.getByText('When Long Nails is selected, automatically include Removal.')).toBeInTheDocument();
    expect(screen.queryByText(/ruleType/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/priority/i)).not.toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/rule_1\b/);
    expect(document.body.textContent ?? '').not.toMatch(/svc_long\b/);
    expect(document.body.textContent ?? '').not.toMatch(/addon_removal\b/);
  });

  it('renders each of the six owner intents as a plain sentence (prevent_combination and limit_add_on_quantity per the brief\'s own examples)', () => {
    const rules: CatalogRuleResponse[] = [
      {
        id: 'rule_conflict',
        ruleType: 'mutually_exclusive',
        serviceScopeId: null,
        subjectAddOnId: 'addon_french',
        subjectServiceId: null,
        objectAddOnId: 'addon_removal',
        capabilityId: null,
        params: {},
        priority: 0,
        isActive: true,
        note: null,
      },
      {
        id: 'rule_limit',
        ruleType: 'max_quantity',
        serviceScopeId: null,
        subjectServiceId: 'svc_long',
        subjectAddOnId: null,
        objectAddOnId: 'addon_french',
        capabilityId: null,
        params: { maxQuantity: 2 },
        priority: 0,
        isActive: true,
        note: null,
      },
      {
        id: 'rule_skill',
        ruleType: 'requires_capability',
        serviceScopeId: null,
        subjectServiceId: 'svc_long',
        subjectAddOnId: null,
        objectAddOnId: null,
        capabilityId: 'cap_1',
        params: {},
        priority: 0,
        isActive: true,
        note: null,
      },
    ];
    renderPanel(rules);

    expect(screen.getByText('French Tips cannot be combined with Removal.')).toBeInTheDocument();
    expect(screen.getByText('Limit French Tips to at most 2 when Long Nails is selected.')).toBeInTheDocument();
    expect(screen.getByText('Only technicians who can do Advanced nail art may perform Long Nails.')).toBeInTheDocument();
  });

  it('the new-rule flow presents six plain-language intents, never a raw vocabulary picker', () => {
    renderPanel([]);
    fireEvent.click(screen.getByTestId('rule-create-open'));
    const dialog = screen.getByTestId('rule-form-dialog');

    expect(within(dialog).getByText('Bundle an add-on')).toBeInTheDocument();
    expect(within(dialog).getByText('Block a combination')).toBeInTheDocument();
    expect(within(dialog).getByText('Require a skill')).toBeInTheDocument();
    expect(within(dialog).queryByText('mutually_exclusive')).not.toBeInTheDocument();
  });

  it('creating a "limit quantity" rule sends the owner-intent shape (never a raw ruleType/params/priority) with label association and validation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { rule: { id: 'rule_new', ruleType: 'max_quantity', serviceScopeId: null, subjectServiceId: 'svc_long', subjectAddOnId: null, objectAddOnId: 'addon_french', capabilityId: null, params: { maxQuantity: 2 }, priority: 0, isActive: true, note: null } },
    }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const { onRefresh } = renderPanel([]);

    fireEvent.click(screen.getByTestId('rule-create-open'));
    const dialog = screen.getByTestId('rule-form-dialog');
    fireEvent.click(within(dialog).getByTestId('rule-intent-limit_add_on_quantity'));

    // Validation: no subject picked yet.
    fireEvent.click(within(dialog).getByTestId('rule-save'));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Pick what this rule applies to.');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('Service'), { target: { value: 'svc_long' } });
    fireEvent.change(within(dialog).getByLabelText('Add-on'), { target: { value: 'addon_french' } });
    fireEvent.change(within(dialog).getByLabelText('Maximum quantity'), { target: { value: '2' } });

    fireEvent.click(within(dialog).getByTestId('rule-save'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;

    expect(url).toBe('/api/salon/catalog-rules');

    const body = JSON.parse(String(init.body));

    expect(body).toMatchObject({
      intent: 'limit_add_on_quantity',
      subjectKind: 'service',
      subjectId: 'svc_long',
      addOnId: 'addon_french',
      maxQuantity: 2,
    });
    expect(body).not.toHaveProperty('ruleType');
    expect(body).not.toHaveProperty('params');
    expect(body).not.toHaveProperty('priority');

    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it('double-submit protection on rule save sends exactly one request', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { onRefresh } = renderPanel([]);

    fireEvent.click(screen.getByTestId('rule-create-open'));
    const dialog = screen.getByTestId('rule-form-dialog');
    fireEvent.click(within(dialog).getByTestId('rule-intent-exclude_add_on'));
    fireEvent.change(within(dialog).getByLabelText('Service'), { target: { value: 'svc_long' } });
    fireEvent.change(within(dialog).getByLabelText('Add-on'), { target: { value: 'addon_french' } });

    const saveButton = within(dialog).getByTestId('rule-save');
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(new Response(JSON.stringify({
      data: { rule: { id: 'rule_x', ruleType: 'exclude', serviceScopeId: null, subjectServiceId: 'svc_long', subjectAddOnId: null, objectAddOnId: 'addon_french', capabilityId: null, params: {}, priority: 0, isActive: true, note: null } },
    }), { status: 201 }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it('deleting a rule requires confirmation and shows the server error on failure', async () => {
    const rule: CatalogRuleResponse = {
      id: 'rule_del',
      ruleType: 'exclude',
      serviceScopeId: null,
      subjectServiceId: 'svc_long',
      subjectAddOnId: null,
      objectAddOnId: 'addon_french',
      capabilityId: null,
      params: {},
      priority: 0,
      isActive: true,
      note: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'RULE_NOT_FOUND', message: 'Rule not found.' },
    }), { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPanel([rule]);

    fireEvent.click(screen.getByTestId('rule-delete-rule_del'));
    const confirmDialog = screen.getByTestId('confirm-dialog');
    fireEvent.click(within(confirmDialog).getByTestId('confirm-dialog-confirm'));

    expect(await within(confirmDialog).findByText('Rule not found.')).toBeInTheDocument();
  });
});
