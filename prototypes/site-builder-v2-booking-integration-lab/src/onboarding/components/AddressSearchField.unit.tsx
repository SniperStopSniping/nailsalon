import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { searchAddresses } from '../integrations/address-search';
import { AddressSearchField } from './AddressSearchField';

vi.mock('../integrations/address-search', () => ({ searchAddresses: vi.fn() }));
const suggestion = { address: '100 Queen Street West, Toronto, Ontario M5H 2N2', city: 'Toronto', label: '100 Queen Street West, Toronto, Ontario M5H 2N2' };

function Harness({ onSelect }: { onSelect?: ReturnType<typeof vi.fn> }) {
  const [value, setValue] = useState('');
  return (
    <AddressSearchField
      city="Toronto"
      label="Exact address"
      onChange={setValue}
      onSelect={(selected) => {
        setValue(selected.address);
        onSelect?.(selected);
      }}
      value={value}
    />
  );
}

async function search(value = '100 Queen') {
  const input = screen.getByRole('combobox', { name: 'Exact address' });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(650);
  });
  return input;
}

describe('AddressSearchField', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(searchAddresses).mockReset().mockResolvedValue([suggestion]);
  });

  afterEach(() => vi.useRealTimers());

  it('debounces manual typing and fills the selected address without submitting', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);

    expect(searchAddresses).not.toHaveBeenCalled();

    const input = await search();

    expect(searchAddresses).toHaveBeenCalledTimes(1);
    expect(searchAddresses).toHaveBeenCalledWith('100 Queen', 'Toronto', expect.any(AbortSignal));

    fireEvent.click(screen.getByRole('option', { name: suggestion.label }));

    expect(input).toHaveValue(suggestion.address);
    expect(onSelect).toHaveBeenCalledWith(suggestion);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(searchAddresses).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { value: `${suggestion.address}, Unit 4` } });

    expect(input).toHaveValue(`${suggestion.address}, Unit 4`);
  });

  it('supports arrows, Enter and Escape without trapping focus', async () => {
    render(<Harness />);
    const input = await search();
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option').id);

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input).toHaveValue(suggestion.address);

    fireEvent.change(input, { target: { value: '100 Queen West' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
    });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps manual entry usable when the lookup fails or has no results', async () => {
    vi.mocked(searchAddresses).mockRejectedValueOnce(new Error('offline'));
    render(<Harness />);
    const input = await search();

    expect(input).toHaveValue('100 Queen');
    expect(screen.getByRole('status')).toHaveTextContent('You can still enter your address manually');

    vi.mocked(searchAddresses).mockResolvedValueOnce([]);
    fireEvent.change(input, { target: { value: 'Manual address' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
    });

    expect(input).toHaveValue('Manual address');
    expect(screen.getByRole('status')).toHaveTextContent('No matching address');
  });

  it('ignores stale results and does not search short input', async () => {
    let resolveFirst: ((results: typeof suggestion[]) => void) | undefined;
    vi.mocked(searchAddresses).mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirst = resolve;
    }));
    render(<Harness />);
    const input = await search('10');

    expect(searchAddresses).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '100 Queen' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(650);
    });
    const oldSignal = vi.mocked(searchAddresses).mock.calls[0]![2];
    fireEvent.change(input, { target: { value: 'Different address' } });

    expect(oldSignal.aborted).toBe(true);

    await act(async () => {
      resolveFirst?.([suggestion]);
    });

    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });
});
