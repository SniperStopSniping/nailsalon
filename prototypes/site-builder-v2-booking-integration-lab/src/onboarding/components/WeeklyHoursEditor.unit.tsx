import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { vi } from 'vitest';

import { createDefaultWeeklyHours } from '../model/defaults';
import { applyRegularHours } from '../model/hours';
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
    const view = render(<Harness />);
    return { getLatest: () => latest, onSkip, unmount: view.unmount };
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

  it('narrows an uncustomized Every day base to Monday–Friday without confirmation', async () => {
    const user = userEvent.setup();
    const initial = applyRegularHours(
      createDefaultWeeklyHours(),
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      '10:00',
      '19:00',
    )!;
    const { getLatest } = renderEditor(initial);

    await user.click(screen.getByRole('radio', { name: 'Monday–Friday' }));
    await user.click(screen.getByRole('button', { name: 'Apply to selected days' }));

    expect(screen.queryByRole('dialog', { name: 'Replace your current hours?' }))
      .not.toBeInTheDocument();
    expect(getLatest().days.friday).toEqual({ close: '19:00', closed: false, open: '10:00' });
    expect(getLatest().days.saturday).toEqual({ close: '', closed: true, open: '' });
    expect(getLatest().days.sunday).toEqual({ close: '', closed: true, open: '' });
  });

  it('keeps or replaces individual adjustments only after explicit confirmation', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Save Friday' }));
    await user.click(screen.getByRole('radio', { name: 'Monday–Friday' }));
    await user.click(screen.getByRole('button', { name: 'Apply to selected days' }));

    const firstDialog = screen.getByRole('dialog', { name: 'Replace your current hours?' });

    expect(firstDialog).toHaveTextContent('marks the other days Closed');

    await user.click(within(firstDialog).getByRole('button', { name: 'Keep current hours' }));

    expect(getLatest().days.friday).toEqual({ close: '17:00', closed: false, open: '09:00' });
    expect(getLatest().days.saturday).toEqual({ close: '19:00', closed: false, open: '10:00' });

    await user.click(screen.getByRole('button', { name: 'Apply to selected days' }));
    const secondDialog = screen.getByRole('dialog', { name: 'Replace your current hours?' });
    await user.click(within(secondDialog).getByRole('button', { name: 'Replace hours' }));

    expect(getLatest().days.friday).toEqual({ close: '19:00', closed: false, open: '10:00' });
    expect(getLatest().days.saturday).toEqual({ close: '', closed: true, open: '' });
    expect(getLatest().days.sunday).toEqual({ close: '', closed: true, open: '' });
    expect(screen.queryByRole('dialog', { name: 'Replace your current hours?' }))
      .not.toBeInTheDocument();
  });

  it('retains overwrite protection after remount for a manually closed, single-interval custom week', async () => {
    const user = userEvent.setup();
    const initial = applyRegularHours(
      createDefaultWeeklyHours(),
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
      '10:00',
      '19:00',
    )!;
    const firstMount = renderEditor(initial);

    await user.click(screen.getByRole('button', { name: 'Edit Wednesday hours' }));
    await user.click(screen.getByRole('radio', { name: 'Closed' }));
    await user.click(screen.getByRole('button', { name: 'Save Wednesday' }));
    const customized = firstMount.getLatest();
    firstMount.unmount();

    const secondMount = renderEditor(customized);
    await user.click(screen.getByRole('radio', { name: 'Monday–Friday' }));
    await user.click(screen.getByRole('button', { name: 'Apply to selected days' }));

    expect(screen.getByRole('dialog', { name: 'Replace your current hours?' })).toBeVisible();
    expect(secondMount.getLatest()).toEqual(customized);
    expect(secondMount.getLatest().days.wednesday.closed).toBe(true);
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
    await user.click(screen.getByRole('button', { name: 'Copy these hours to other days' }));
    const copyGroup = screen.getByRole('group', { name: 'Apply these hours to:' });
    await user.click(within(copyGroup).getByRole('checkbox', { name: 'Sat' }));

    expect(getLatest().days.friday.open).toBe('10:00');

    await user.click(screen.getByRole('button', { name: 'Apply hours' }));

    expect(getLatest().days.friday).toEqual({ close: '17:00', closed: false, open: '09:00' });
    expect(getLatest().days.saturday).toEqual(getLatest().days.friday);

    await user.click(screen.getByRole('button', { name: 'Edit Sunday hours' }));

    expect(screen.getByRole('radio', { name: 'Closed' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Save Sunday' }));

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
