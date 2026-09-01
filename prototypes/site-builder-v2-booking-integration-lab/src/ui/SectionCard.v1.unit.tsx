import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { initializeStarter } from '../model/starters';
import { SectionCard } from './SectionCard';

describe('V1 Builder section cards', () => {
  it('shows a truthful connected-content summary instead of a permanent skeleton', () => {
    const document = initializeStarter('quick_book');
    const page = document.pages[0]!;
    const section = page.sections.find(candidate => candidate.sectionType === 'hero');
    if (!section) {
      throw new Error('Quick Book fixture has no editable Hero section.');
    }

    const { container } = render(
      <SectionCard
        page={page}
        section={section}
        selected={false}
        onEdit={vi.fn()}
        onEnterReorder={vi.fn()}
        onMove={vi.fn()}
        onRemove={vi.fn()}
        onSelect={vi.fn()}
        onToggleVisible={vi.fn()}
      />,
    );

    expect(screen.getByText('Uses the salon identity and a dedicated opening image when one is available.'))
      .toBeVisible();
    expect(screen.getByText('Open Preview to see the exact customer experience.')).toBeVisible();
    expect(container.querySelector('.placeholder-grid')).not.toBeInTheDocument();
  });
});
