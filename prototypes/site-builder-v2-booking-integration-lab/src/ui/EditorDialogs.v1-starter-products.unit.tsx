import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { initializeStarter, type SiteBuilderDocument } from '../model';
import { SectionLibraryDialog } from './EditorDialogs';

const createOnePageDocument = (): SiteBuilderDocument => {
  const document = initializeStarter('one_page');
  const home = document.pages[0];
  if (!home) {
    throw new Error('One-page starter is missing Home.');
  }
  return {
    ...document,
    pages: [{
      ...home,
      sections: home.sections.filter(section => section.sectionType === 'hero'),
    }],
    unusedSections: [],
  };
};

const renderLibrary = (
  document: SiteBuilderDocument,
  auditMode: boolean,
  businessStructure: 'multi_tech' | 'solo' | null = 'solo',
) => {
  const page = document.pages[0];
  if (!page) {
    throw new Error('Test document is missing Home.');
  }
  render(
    <SectionLibraryDialog
      auditMode={auditMode}
      businessStructure={businessStructure}
      document={document}
      insertionPosition={2}
      libraryAddState={() => ({ blocked: false })}
      onAdd={vi.fn()}
      onAddLibrary={vi.fn()}
      onClose={vi.fn()}
      onGoToBooking={vi.fn()}
      onRestore={vi.fn()}
      page={page}
    />,
  );
  return screen.getByRole('dialog', { name: 'Add section' });
};

describe('SectionLibraryDialog V1 product scope', () => {
  it('shows only missing core families in normal mode', () => {
    const dialog = renderLibrary(createOnePageDocument(), false);

    expect(within(dialog).getByText('Core website sections')).toBeVisible();
    expect(within(dialog).queryByRole('searchbox')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add Gallery' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Add About' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Add Reviews' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Add Before You Book' })).toBeVisible();
    expect(within(dialog).getByRole('button', {
      name: 'Add Visit & Contact',
    })).toBeVisible();
    expect(within(dialog).getByRole('button', {
      name: 'Add Services & Booking',
    })).toBeVisible();
    expect(within(dialog).queryByText('Announcement Bar')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Featured Services')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Custom Design')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Go to Booking' })).not.toBeInTheDocument();
  });

  it('offers Team instead of About for a multi-tech business', () => {
    const dialog = renderLibrary(createOnePageDocument(), false, 'multi_tech');

    expect(within(dialog).getByRole('button', { name: 'Add Team' })).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Add About' })).not.toBeInTheDocument();
  });

  it('restores a removed core family without offering a duplicate new instance', () => {
    const document = initializeStarter('one_page');
    const home = document.pages[0];
    if (!home) {
      throw new Error('One-page starter is missing Home.');
    }
    const gallery = home.sections.find(section => section.sectionType === 'gallery');
    if (!gallery || gallery.sectionType !== 'gallery') {
      throw new Error('One-page starter is missing Gallery.');
    }
    document.pages = [{
      ...home,
      sections: home.sections.filter(section => (
        section.sectionType === 'hero'
      )),
    }];
    document.unusedSections = [gallery];

    const dialog = renderLibrary(document, false);

    expect(within(dialog).getByRole('button', {
      name: 'Restore removed Gallery',
    })).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Add Gallery' })).not.toBeInTheDocument();
  });

  it('preserves the full technical inventory in audit mode', () => {
    const dialog = renderLibrary(createOnePageDocument(), true);

    expect(within(dialog).getByRole('searchbox', { name: 'Search sections' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Add Announcement Bar' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Add Featured Services' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Add Custom Design' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Go to Booking' })).toBeVisible();
  });
});
