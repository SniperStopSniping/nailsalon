import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import type {
  FaqSettings,
  OffersSettings,
  QuickInfoSettings,
  ReviewsSettings,
} from '../../model/section-library/settings';
import type {
  OfferRecord,
  SiteContentCollections,
} from '../../model/section-library/site-content';
import { initializeStarter } from '../../model/starters';
import type {
  SiteBuilderDocument,
  UpdateSiteContentInput,
} from '../../model/types';
import {
  DEMO_SITE_CONTENT,
  createDemoOnboardingState,
} from '../../onboarding/model/demo-content';
import { deriveSiteLibraryContext } from '../../onboarding/model/site-library-context';
import { FaqEditor } from './faq';
import { OffersEditor } from './offers';
import { QuickInfoEditor } from './quick-info';
import { ReviewsEditor } from './reviews';

const createEditorProps = (
  siteContent: SiteContentCollections = DEMO_SITE_CONTENT,
) => {
  const state = createDemoOnboardingState();
  const siteDocument: SiteBuilderDocument = {
    ...initializeStarter('quick_book'),
    siteContent,
  };
  return {
    context: deriveSiteLibraryContext(state, siteDocument),
    document: siteDocument,
    onChange: vi.fn(),
    onSiteContent: vi.fn((_input: UpdateSiteContentInput) => true),
    profile: state.profile,
  };
};

const findRecord = <T extends { id: string }>(
  records: readonly T[],
  id: string,
): T => {
  const record = records.find(candidate => candidate.id === id);
  if (!record) throw new Error(`Demo site content is missing ${id}.`);
  return record;
};

/** Record fields live inside a collapsed `<details>`; open it to read them. */
const openRecord = (name: RegExp): HTMLElement => {
  const panel = screen.getByRole('checkbox', { name }).closest('details');
  if (!panel) throw new Error(`No record panel for ${String(name)}.`);
  panel.open = true;
  return panel;
};

const NEW_CLIENT_OFFER = findRecord(DEMO_SITE_CONTENT.offers, 'demo-offer-new-client');
const DUO_OFFER = findRecord(DEMO_SITE_CONTENT.offers, 'demo-offer-duo');
const MAYA_REVIEW = findRecord(DEMO_SITE_CONTENT.reviews, 'demo-review-maya');
const PREP_FAQ = findRecord(DEMO_SITE_CONTENT.faq, 'demo-faq-prep');

describe('OffersEditor', () => {
  const settings: OffersSettings = {
    offerIds: ['demo-offer-new-client'],
    preset: 'cards',
    version: 1,
  };

  it('renders the bound offers and their shared record values', () => {
    const props = createEditorProps();
    render(<OffersEditor {...props} settings={settings} />);

    expect(screen.getByRole('checkbox', {
      name: 'Show New client welcome in this section',
    })).toBeChecked();
    expect(screen.getByRole('checkbox', {
      name: 'Show Bestie mornings in this section',
    })).not.toBeChecked();
    const panel = openRecord(/Show New client welcome/);
    expect(within(panel).getByLabelText(/Offer title/)).toHaveValue(NEW_CLIENT_OFFER.title);
    expect(within(panel).getByLabelText(/What the client gets/)).toHaveValue(
      NEW_CLIENT_OFFER.detail,
    );
    expect(within(panel).getByLabelText(/Button label/)).toHaveValue(
      NEW_CLIENT_OFFER.actionLabel ?? '',
    );
  });

  it('binds a second offer with the exact next settings', async () => {
    const props = createEditorProps();
    render(<OffersEditor {...props} settings={settings} />);

    await userEvent.setup().click(screen.getByRole('checkbox', {
      name: 'Show Bestie mornings in this section',
    }));

    expect(props.onChange).toHaveBeenCalledOnce();
    expect(props.onChange).toHaveBeenCalledWith({
      offerIds: ['demo-offer-new-client', 'demo-offer-duo'],
      preset: 'cards',
      version: 1,
    });
  });

  it('applies a record edit immediately as an exact upsert', () => {
    const props = createEditorProps();
    render(<OffersEditor {...props} settings={settings} />);
    const panel = openRecord(/Show New client welcome/);

    fireEvent.change(within(panel).getByLabelText(/Terms/), {
      target: { value: 'First visit only, weekdays.' },
    });

    expect(props.onSiteContent).toHaveBeenCalledOnce();
    expect(props.onSiteContent).toHaveBeenCalledWith({
      collection: 'offers',
      operation: 'upsert',
      record: { ...NEW_CLIENT_OFFER, terms: 'First visit only, weekdays.' },
    });
    // The settings draft is untouched by a shared-record edit.
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('stores a cleared end date and button label as null, never an empty string', () => {
    const expiring: OfferRecord = { ...DUO_OFFER, expiresAt: '2026-12-24' };
    const props = createEditorProps({ ...DEMO_SITE_CONTENT, offers: [expiring] });
    render(<OffersEditor {...props} settings={{ ...settings, offerIds: ['demo-offer-duo'] }} />);
    const panel = openRecord(/Show Bestie mornings/);

    expect(within(panel).getByLabelText(/Ends on/)).toHaveValue('2026-12-24');
    fireEvent.change(within(panel).getByLabelText(/Ends on/), { target: { value: '' } });
    fireEvent.change(within(panel).getByLabelText(/Button label/), { target: { value: '' } });

    expect(props.onSiteContent).toHaveBeenNthCalledWith(1, {
      collection: 'offers',
      operation: 'upsert',
      record: { ...expiring, expiresAt: null },
    });
    expect(props.onSiteContent).toHaveBeenNthCalledWith(2, {
      collection: 'offers',
      operation: 'upsert',
      record: { ...expiring, actionLabel: null },
    });
  });
});

describe('ReviewsEditor', () => {
  const settings: ReviewsSettings = {
    preset: 'testimonial_cards',
    reviewIds: ['demo-review-maya'],
    showRatings: true,
    version: 1,
  };

  it('renders the ratings switch and the bound reviews', () => {
    const props = createEditorProps();
    render(<ReviewsEditor {...props} settings={settings} />);

    expect(screen.getByRole('checkbox', { name: /Show star ratings/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Show Maya R\./ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Show Jess T\./ })).not.toBeChecked();
    const panel = openRecord(/Show Maya R\./);
    expect(within(panel).getByLabelText(/What they said/)).toHaveValue(MAYA_REVIEW.quote);
    expect(within(panel).getByRole('button', { name: '5' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('turns ratings off with the exact next settings', async () => {
    const props = createEditorProps();
    render(<ReviewsEditor {...props} settings={settings} />);

    await userEvent.setup().click(screen.getByRole('checkbox', { name: /Show star ratings/ }));

    expect(props.onChange).toHaveBeenCalledOnce();
    expect(props.onChange).toHaveBeenCalledWith({
      preset: 'testimonial_cards',
      reviewIds: ['demo-review-maya'],
      showRatings: false,
      version: 1,
    });
  });

  it('clears a rating to null through an exact record upsert', async () => {
    const props = createEditorProps();
    render(<ReviewsEditor {...props} settings={settings} />);
    const panel = openRecord(/Show Maya R\./);

    await userEvent.setup().click(within(panel).getByRole('button', { name: 'No rating' }));

    expect(props.onSiteContent).toHaveBeenCalledOnce();
    expect(props.onSiteContent).toHaveBeenCalledWith({
      collection: 'reviews',
      operation: 'upsert',
      record: { ...MAYA_REVIEW, rating: null },
    });
  });
});

describe('FaqEditor', () => {
  const settings: FaqSettings = {
    itemIds: ['demo-faq-prep', 'demo-faq-lasting'],
    version: 1,
  };

  it('renders which questions this section shows', () => {
    const props = createEditorProps();
    render(<FaqEditor {...props} settings={settings} />);

    expect(screen.getByRole('checkbox', { name: /How should I prepare/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Can I bring nail inspiration/ }))
      .not.toBeChecked();
    const panel = openRecord(/How should I prepare/);
    expect(within(panel).getByLabelText(/Answer/)).toHaveValue(PREP_FAQ.answer);
  });

  it('binds another question with the exact next settings', async () => {
    const props = createEditorProps();
    render(<FaqEditor {...props} settings={settings} />);

    await userEvent.setup().click(screen.getByRole('checkbox', {
      name: /Can I bring nail inspiration/,
    }));

    expect(props.onChange).toHaveBeenCalledOnce();
    expect(props.onChange).toHaveBeenCalledWith({
      itemIds: ['demo-faq-prep', 'demo-faq-lasting', 'demo-faq-inspo'],
      version: 1,
    });
  });

  it('applies an answer edit immediately as an exact upsert', () => {
    const props = createEditorProps();
    render(<FaqEditor {...props} settings={settings} />);
    const panel = openRecord(/How should I prepare/);

    fireEvent.change(within(panel).getByLabelText(/Answer/), {
      target: { value: 'Come with bare nails if you can.' },
    });

    expect(props.onSiteContent).toHaveBeenCalledOnce();
    expect(props.onSiteContent).toHaveBeenCalledWith({
      collection: 'faq',
      operation: 'upsert',
      record: { ...PREP_FAQ, answer: 'Come with bare nails if you can.' },
    });
  });

  it('only adds a question once it has an answer, then binds the new record', async () => {
    const props = createEditorProps();
    const user = userEvent.setup();
    render(<FaqEditor {...props} settings={settings} />);
    const addButton = screen.getByRole('button', { name: 'Add question' });

    await user.type(
      screen.getByPlaceholderText('How should I prepare for my appointment?'),
      'Do you take walk-ins?',
    );
    expect(addButton).toBeDisabled();
    await user.type(screen.getByPlaceholderText(/Its answer/), 'Appointments only for now.');
    await user.click(addButton);

    const input = props.onSiteContent.mock.calls[0]?.[0];
    if (input?.operation !== 'upsert') throw new Error('Expected an upsert.');
    expect(input.record.id).toMatch(/^faq-/);
    expect(input).toEqual({
      collection: 'faq',
      operation: 'upsert',
      record: {
        answer: 'Appointments only for now.',
        id: input.record.id,
        question: 'Do you take walk-ins?',
      },
    });
    expect(props.onChange).toHaveBeenCalledWith({
      itemIds: ['demo-faq-prep', 'demo-faq-lasting', input.record.id],
      version: 1,
    });
  });
});

describe('QuickInfoEditor', () => {
  const settings: QuickInfoSettings = {
    facts: ['location', 'visit_mode'],
    version: 1,
  };

  it('renders every fact with its live shared value, ticked ones first', () => {
    const props = createEditorProps();
    render(<QuickInfoEditor {...props} settings={{ ...settings, facts: ['visit_mode', 'location'] }} />);

    expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    const [first, second] = screen.getAllByRole('checkbox');
    expect(first?.closest('label')).toHaveTextContent('Appointments or walk-ins');
    expect(second?.closest('label')).toHaveTextContent('Area or address');
    expect(screen.getByText('1189 Queen St E, Toronto')).toBeInTheDocument();
    expect(screen.getByText('Appointment only')).toBeInTheDocument();
    expect(screen.getByText('Accepting new clients')).toBeInTheDocument();
    expect(screen.getByText('Book 12h ahead')).toBeInTheDocument();
  });

  it('says nothing to show for a fact whose shared value is empty', () => {
    const props = createEditorProps();
    const profile = {
      ...props.profile,
      bookingPreferences: { ...props.profile.bookingPreferences, minimumNoticeMinutes: 0 },
      hours: { ...props.profile.hours, showOnSite: false },
    };
    render(<QuickInfoEditor {...props} profile={profile} settings={settings} />);

    expect(screen.getAllByText('(nothing to show yet)')).toHaveLength(2);
  });

  it('ticks a fact onto the end of the display order with the exact next settings', async () => {
    const props = createEditorProps();
    render(<QuickInfoEditor {...props} settings={settings} />);

    await userEvent.setup().click(screen.getByRole('checkbox', { name: /How far ahead to book/ }));

    expect(props.onChange).toHaveBeenCalledOnce();
    expect(props.onChange).toHaveBeenCalledWith({
      facts: ['location', 'visit_mode', 'minimum_notice'],
      version: 1,
    });
  });

  it('locks the fourth fact and the last remaining fact', () => {
    const props = createEditorProps();
    const { unmount } = render(
      <QuickInfoEditor
        {...props}
        settings={{ ...settings, facts: ['location', 'visit_mode', 'new_clients', 'open_status'] }}
      />,
    );

    expect(screen.getByRole('checkbox', { name: /How far ahead to book/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Area or address/ })).toBeEnabled();
    unmount();

    render(<QuickInfoEditor {...props} settings={{ ...settings, facts: ['location'] }} />);
    expect(screen.getByRole('checkbox', { name: /Area or address/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Open right now/ })).toBeEnabled();
  });
});
