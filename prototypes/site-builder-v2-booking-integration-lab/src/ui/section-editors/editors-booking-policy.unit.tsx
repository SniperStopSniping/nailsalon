import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { CANONICAL_SERVICES } from '../../booking/data';
import { formatPrice } from '../../booking/helpers';
import { SECTION_LIBRARY_REGISTRY } from '../../model/section-library/registry';
import type {
  DepositsCancellationsSettings,
  FeaturedServicesSettings,
  HoursSectionSettings,
  PoliciesSectionSettings,
} from '../../model/section-library/settings';
import { initializeStarter } from '../../model/starters';
import type { SiteBuilderDocument } from '../../model/types';
import {
  createDemoOnboardingState,
  DEMO_SITE_CONTENT,
} from '../../onboarding/model/demo-content';
import {
  deriveDepositsAndCancellationsSummary,
  getDepositsAndCancellationsDisplayWording,
} from '../../onboarding/model/policies';
import { deriveSiteLibraryContext } from '../../onboarding/model/site-library-context';
import type { OnboardingLabState } from '../../onboarding/model/types';
import { DepositsCancellationsEditor } from './deposits-cancellations';
import { FeaturedServicesEditor } from './featured-services';
import { HoursEditor } from './hours';
import { PoliciesEditor } from './policies';

const createDemoDocument = (): SiteBuilderDocument => ({
  ...initializeStarter('quick_book'),
  siteContent: DEMO_SITE_CONTENT,
});

const createSharedProps = (state: OnboardingLabState = createDemoOnboardingState()) => {
  const siteDocument = createDemoDocument();
  return {
    context: deriveSiteLibraryContext(state, siteDocument),
    document: siteDocument,
    onSiteContent: vi.fn(() => true),
    profile: state.profile,
  };
};

describe('FeaturedServicesEditor', () => {
  const featuredSettings: FeaturedServicesSettings = {
    preset: 'grid',
    serviceIds: [],
    source: 'featured',
    version: 1,
  };

  test('shows the resolved Luster picks read-only, with no service checkboxes', () => {
    const shared = createSharedProps();
    const { container } = render(
      <FeaturedServicesEditor
        {...shared}
        onChange={vi.fn()}
        settings={featuredSettings}
      />,
    );

    const expected = shared.context.featuredServiceIds
      .map(id => CANONICAL_SERVICES.find(service => service.id === id))
      .filter((service): service is (typeof CANONICAL_SERVICES)[number] => Boolean(service))
      .map(service => `${service.name} · ${formatPrice(service.price)}`);
    expect(expected.length).toBeGreaterThan(0);
    expect([...container.querySelectorAll('li')].map(item => item.textContent))
      .toEqual(expected);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByText(/This list follows your menu/u)).toBeInTheDocument();
  });

  test('switching to “I choose” calls onChange with exactly the new source', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FeaturedServicesEditor
        {...createSharedProps()}
        onChange={onChange}
        settings={featuredSettings}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'I choose' }));

    const next: FeaturedServicesSettings = {
      preset: 'grid',
      serviceIds: [],
      source: 'manual',
      version: 1,
    };
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(next);
    expect(SECTION_LIBRARY_REGISTRY.featured_services.normalize(next)).toEqual(next);
  });

  test('ticking a menu service appends it in selection order', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const shared = createSharedProps();
    const menuIds = shared.context.canonicalServiceIds;
    const settings: FeaturedServicesSettings = {
      preset: 'grid',
      serviceIds: [menuIds[0]!],
      source: 'manual',
      version: 1,
    };
    render(
      <FeaturedServicesEditor {...shared} onChange={onChange} settings={settings} />,
    );

    await user.click(screen.getAllByRole('checkbox')[2]!);

    const next: FeaturedServicesSettings = {
      preset: 'grid',
      serviceIds: [menuIds[0]!, menuIds[2]!],
      source: 'manual',
      version: 1,
    };
    expect(onChange).toHaveBeenCalledWith(next);
    expect(SECTION_LIBRARY_REGISTRY.featured_services.normalize(next)).toEqual(next);
  });

  test('disables the unpicked services once six are chosen (the registry clamp)', () => {
    const shared = createSharedProps();
    render(
      <FeaturedServicesEditor
        {...shared}
        onChange={vi.fn()}
        settings={{
          preset: 'grid',
          serviceIds: shared.context.canonicalServiceIds.slice(0, 6),
          source: 'manual',
          version: 1,
        }}
      />,
    );

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toBeEnabled();
    expect(checkboxes[5]).toBeEnabled();
    expect(checkboxes[6]).toBeDisabled();
    expect(screen.getByText(/6 of 6 chosen/u)).toBeInTheDocument();
  });

  test('offers a real way out when picks have left the menu', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const shared = createSharedProps();
    const liveId = shared.context.canonicalServiceIds[0]!;
    render(
      <FeaturedServicesEditor
        {...shared}
        onChange={onChange}
        settings={{
          preset: 'grid',
          serviceIds: [liveId, 'svc-retired-from-menu'],
          source: 'manual',
          version: 1,
        }}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Remove 1 service that left your menu' }),
    );

    const next: FeaturedServicesSettings = {
      preset: 'grid',
      serviceIds: [liveId],
      source: 'manual',
      version: 1,
    };
    expect(onChange).toHaveBeenCalledWith(next);
    expect(SECTION_LIBRARY_REGISTRY.featured_services.normalize(next)).toEqual(next);
  });
});

describe('DepositsCancellationsEditor', () => {
  const summarySettings: DepositsCancellationsSettings = {
    version: 1,
    wordingMode: 'summary',
  };

  test('previews the live summary and full customer wording', () => {
    render(
      <DepositsCancellationsEditor
        {...createSharedProps()}
        onChange={vi.fn()}
        settings={summarySettings}
      />,
    );

    const shared = createSharedProps();
    expect(screen.getByText('Short summary — on your site now')).toBeInTheDocument();
    expect(screen.getByText(
      `“${deriveDepositsAndCancellationsSummary(shared.profile.policies)}”`,
    )).toBeInTheDocument();
    expect(screen.getByText(
      `“${getDepositsAndCancellationsDisplayWording(shared.profile.policies)}”`,
    )).toBeInTheDocument();
    expect(screen.getByText(/\$30 deposit · 24 hours’ notice/u)).toBeInTheDocument();
  });

  test('choosing full wording calls onChange with exactly the new settings', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DepositsCancellationsEditor
        {...createSharedProps()}
        onChange={onChange}
        settings={summarySettings}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Full wording' }));

    const next: DepositsCancellationsSettings = { version: 1, wordingMode: 'full' };
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(next);
    expect(SECTION_LIBRARY_REGISTRY.deposits_cancellations.normalize(next)).toEqual(next);
  });

  test('explains the locked summary instead of inventing one', () => {
    const state = createDemoOnboardingState();
    const incomplete: OnboardingLabState = {
      ...state,
      profile: {
        ...state.profile,
        policies: {
          ...state.profile.policies,
          cancellations: { ...state.profile.policies.cancellations, notice: null },
        },
      },
    };
    render(
      <DepositsCancellationsEditor
        {...createSharedProps(incomplete)}
        onChange={vi.fn()}
        settings={summarySettings}
      />,
    );

    expect(screen.getByText(/The short summary unlocks once/u)).toBeInTheDocument();
    expect(screen.queryByText(/24 hours’ notice/u)).not.toBeInTheDocument();
  });
});

describe('PoliciesEditor', () => {
  const allTopics: PoliciesSectionSettings = {
    includedSections: ['late_arrivals', 'no_shows', 'repairs', 'other'],
    version: 1,
  };

  test('renders the four renderer-matching topics with their live wording', () => {
    render(
      <PoliciesEditor
        {...createSharedProps()}
        onChange={vi.fn()}
        settings={allTopics}
      />,
    );

    for (const label of ['Late arrivals', 'No-shows', 'Repairs', 'Good to know']) {
      expect(screen.getByRole('checkbox', { name: label })).toBeChecked();
    }
    expect(screen.getByText(/We hold your appointment for 15 minutes/u)).toBeInTheDocument();
    expect(
      screen.getByText(/Chips or lifting within 5 days\? Come back and we’ll repair it free\./u),
    ).toBeInTheDocument();
    expect(
      screen.getByText('(hidden in onboarding/policies — turn it back on there to show it here)'),
    ).toBeInTheDocument();
  });

  test('says so honestly when a shown topic has no wording yet', () => {
    const state = createDemoOnboardingState();
    const visibleButEmpty: OnboardingLabState = {
      ...state,
      profile: {
        ...state.profile,
        policies: {
          ...state.profile.policies,
          copy: {
            ...state.profile.policies.copy,
            other: { ...state.profile.policies.copy.other, visible: true },
          },
        },
      },
    };
    render(
      <PoliciesEditor
        {...createSharedProps(visibleButEmpty)}
        onChange={vi.fn()}
        settings={allTopics}
      />,
    );

    expect(
      screen.getByText('(no wording yet — finish this policy in onboarding/policies)'),
    ).toBeInTheDocument();
  });

  test('unticking a topic calls onChange with exactly the remaining topics', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PoliciesEditor
        {...createSharedProps()}
        onChange={onChange}
        settings={allTopics}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Repairs' }));

    const next: PoliciesSectionSettings = {
      includedSections: ['late_arrivals', 'no_shows', 'other'],
      version: 1,
    };
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(next);
    expect(SECTION_LIBRARY_REGISTRY.policies.normalize(next)).toEqual(next);
  });

  test('keeps the last topic on, because an empty list cannot survive normalize', () => {
    render(
      <PoliciesEditor
        {...createSharedProps()}
        onChange={vi.fn()}
        settings={{ includedSections: ['no_shows'], version: 1 }}
      />,
    );

    expect(screen.getByRole('checkbox', { name: 'No-shows' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Repairs' })).toBeEnabled();
    expect(screen.getByText(/One topic has to stay on/u)).toBeInTheDocument();
    expect(
      SECTION_LIBRARY_REGISTRY.policies.normalize({ includedSections: [], version: 1 }),
    ).toEqual(allTopics);
  });
});

describe('HoursEditor', () => {
  const compactSettings: HoursSectionSettings = { layout: 'compact', version: 1 };

  test('compact previews only the open days, with short weekday labels', () => {
    const { container } = render(
      <HoursEditor
        {...createSharedProps()}
        onChange={vi.fn()}
        settings={compactSettings}
      />,
    );

    expect(container.querySelectorAll('dt')).toHaveLength(5);
    expect(screen.getByText('Tue')).toBeInTheDocument();
    expect(screen.queryByText('Mon')).not.toBeInTheDocument();
    expect(screen.queryByText('Closed')).not.toBeInTheDocument();
  });

  test('full week previews every day, closed ones included', () => {
    const { container } = render(
      <HoursEditor
        {...createSharedProps()}
        onChange={vi.fn()}
        settings={{ layout: 'full', version: 1 }}
      />,
    );

    expect(container.querySelectorAll('dt')).toHaveLength(7);
    expect(screen.getByText('Monday')).toBeInTheDocument();
    expect(screen.getAllByText('Closed')).toHaveLength(2);
  });

  test('choosing full week calls onChange with exactly the new settings', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <HoursEditor
        {...createSharedProps()}
        onChange={onChange}
        settings={compactSettings}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Full week' }));

    const next: HoursSectionSettings = { layout: 'full', version: 1 };
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(next);
    expect(SECTION_LIBRARY_REGISTRY.hours.normalize(next)).toEqual(next);
  });

  test('says why the preview is empty when hours are not set up', () => {
    const state = createDemoOnboardingState();
    const noHours: OnboardingLabState = {
      ...state,
      profile: {
        ...state.profile,
        hours: { ...state.profile.hours, setupState: 'unset' },
      },
    };
    const { container } = render(
      <HoursEditor
        {...createSharedProps(noHours)}
        onChange={vi.fn()}
        settings={compactSettings}
      />,
    );

    expect(container.querySelectorAll('dt')).toHaveLength(0);
    expect(screen.getByText(/Your weekly hours are not set up yet/u)).toBeInTheDocument();
  });
});
