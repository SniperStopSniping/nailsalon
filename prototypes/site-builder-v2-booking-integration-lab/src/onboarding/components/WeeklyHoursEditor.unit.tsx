import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';

import { applyRegularHours } from '../model/hours';
import { createDefaultWeeklyHours } from '../model/defaults';
import type { WeeklyHoursDraft } from '../model/types';
import { WeeklyHoursEditor } from './WeeklyHoursEditor';

describe('WeeklyHoursEditor', () => {
  function renderEditor(initial = createDefaultWeeklyHours()) {
    let latest = initial;
    const onSkip = vi.fn();
    function Harness() {
      const [hours, setHours] = useState(initial);
      return (
        <WeeklyHoursEditor
          hours={hours}
          onChange={(next) => {
            latest = next;
            setHours(next);
          }}
          onSkip={onSkip}
        />
      );
    }
    render(<Harness />);
    return { getLatest: () => latest, onSkip };
  }

  it.each([
    ['Every day', 7],
    ['Monday–Friday', 5],
    ['Monday–Saturday', 6],
  ] as const)('applies the %s preset once and reveals compact day rows', async (preset, count) => {
    const user = userEvent.setup();
    const { getLatest } = renderEditor();

    await user.click(screen.getByRole('radio', { name: preset }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Opens' }), '09:00');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Closes' }), '18:00');
    await user.click(screen.getByRole('button', { name: 'Apply to selected days' }));

    expect(Object.values(getLatest().days).filter(({ closed }) => !closed)).toHaveLength(count);
    expect(getLatest().setupState).toBe('configured');
    expect(screen.getByRole('heading', { name: 'Adjust individual days' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit Monday hours' })).toBeVisible();
    expect(screen.getByText(`Regular hours applied to ${count} days.`)).toBeInTheDocument();
  });

  it('supports a custom set of days without writing until Apply', async () => {
    const user = userEvent.setup();
    const { getLatest } = renderEditor();

    await user.click(screen.getByRole('radio', { name: 'Custom days' }));
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
      await user.click(screen.getByRole('checkbox', { name: day }));
    }
    for (const day of ['Tue', 'Thu', 'Sat']) {
      await user.click(screen.getByRole('checkbox', { name: day }));
    }
    expect(getLatest()).toEqual(createDefaultWeeklyHours());
    await user.click(screen.getByRole('button', { name: 'Apply to selected days' }));

    expect(getLatest().days.tuesday.closed).toBe(false);
    expect(getLatest().days.thursday.closed).toBe(false);
    expect(getLatest().days.saturday.closed).toBe(false);
    expect(getLatest().days.sunday.closed).toBe(true);
    expect(Object.values(getLatest().days).filter(({ closed }) => !closed)).toHaveLength(3);
  });

  it('blocks and focuses a closing time that is not after opening', async () => {
    const user = userEvent.setup();
    const { getLatest } = renderEditor();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Opens' }), '10:30');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Closes' }), '09:30');
    await user.click(screen.getByRole('button', { name: 'Apply to selected days' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Closing time must be later than opening time.',
    );
    expect(screen.getByRole('combobox', { name: 'Closes' })).toHaveFocus();
    expect(getLatest()).toEqual(createDefaultWeeklyHours());
    expect(screen.queryByRole('heading', { name: 'Adjust individual days' }))
      .not.toBeInTheDocument();
  });

  it('edits, closes, and copies an individual day only after Save', async () => {
    const user = userEvent.setup();
    const initial = applyRegularHours(
      createDefaultWeeklyHours(),
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
      '10:00',
      '19:00',
    )!;
    const { getLatest } = renderEditor(initial);

    await user.click(screen.getByRole('button', { name: 'Edit Friday hours' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Friday opens' }), '09:00');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Friday closes' }), '17:00');
    await user.click(screen.getByRole('button', { name: 'Copy to other days' }));
    const copyGroup = screen.getByRole('group', { name: 'Copy Friday to' });
    await user.click(within(copyGroup).getByRole('checkbox', { name: 'Sat' }));
    expect(getLatest().days.friday.open).toBe('10:00');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(getLatest().days.friday).toEqual({ close: '17:00', closed: false, open: '09:00' });
    expect(getLatest().days.saturday).toEqual(getLatest().days.friday);

    await user.click(screen.getByRole('button', { name: 'Edit Sunday hours' }));
    expect(screen.getByRole('checkbox', { name: 'Closed' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(getLatest().days.sunday.closed).toBe(true);
  });

  it('derives its editable regular interval from an existing daily schedule', () => {
    const initial = applyRegularHours(
      createDefaultWeeklyHours(),
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      '09:00',
      '18:00',
    ) as WeeklyHoursDraft;

    renderEditor(initial);

    expect(screen.getByRole('radio', { name: 'Monday–Friday' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Opens' })).toHaveValue('09:00');
    expect(screen.getByRole('combobox', { name: 'Closes' })).toHaveValue('18:00');
  });

  it('keeps skipping explicit and separate from an applied schedule', async () => {
    const user = userEvent.setup();
    const { onSkip } = renderEditor();

    await user.click(screen.getByRole('button', { name: 'Skip hours for now' }));
    expect(onSkip).toHaveBeenCalledOnce();
  });
});
