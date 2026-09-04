import { useEffect, useId, useState } from 'react';

import { type AddressSuggestion, searchAddresses } from '../integrations/address-search';
import { TextField } from './FormFields';

type Props = {
  city: string;
  error?: string;
  label: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
  value: string;
};

export function AddressSearchField({ city, error, label, onChange, onSelect, value }: Props) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [edited, setEdited] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const open = focused && !dismissed && suggestions.length > 0;

  useEffect(() => {
    setSuggestions([]);
    setActive(-1);
    setStatus('idle');
    if (!focused || !edited || dismissed || value.trim().length < 4) {
      return;
    }
    const controller = new AbortController();
    let current = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    // A pause after typing bounds traffic to the shared, low-volume provider.
    const debounce = setTimeout(async () => {
      setStatus('loading');
      timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const results = await searchAddresses(value, city, controller.signal);
        if (current) {
          setSuggestions(results);
          setStatus('ready');
        }
      } catch {
        if (current) {
          setStatus('error');
        }
      } finally {
        clearTimeout(timeout);
      }
    }, 650);
    return () => {
      current = false;
      clearTimeout(debounce);
      clearTimeout(timeout);
      controller.abort();
    };
  }, [city, dismissed, edited, focused, value]);

  const select = (suggestion: AddressSuggestion) => {
    setEdited(false);
    setDismissed(true);
    setSuggestions([]);
    onSelect(suggestion);
  };

  return (
    <div
      className="onboarding-address-search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
    >
      <TextField
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        autoComplete="street-address"
        error={error}
        hint="Start typing for suggestions, or enter your address manually. Add your unit or suite after selecting."
        label={label}
        required
        role="combobox"
        value={value}
        onChange={(event) => {
          setEdited(true);
          setDismissed(false);
          onChange(event.target.value);
        }}
        onFocus={() => setFocused(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setDismissed(true);
          } else if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            setActive(index => event.key === 'ArrowDown'
              ? (index + 1) % suggestions.length
              : (index <= 0 ? suggestions.length - 1 : index - 1));
          } else if (open && event.key === 'Enter' && active >= 0) {
            event.preventDefault();
            select(suggestions[active]!);
          }
        }}
      />
      {open
        ? (
            <ul aria-label="Address suggestions" id={listId} role="listbox">
              {suggestions.map((suggestion, index) => (
                <li key={suggestion.address} role="presentation">
                  <button
                    aria-selected={index === active}
                    id={`${listId}-${index}`}
                    role="option"
                    tabIndex={-1}
                    type="button"
                    onClick={() => select(suggestion)}
                    onMouseDown={event => event.preventDefault()}
                  >
                    {suggestion.label}
                  </button>
                </li>
              ))}
            </ul>
          )
        : null}
      <p className="onboarding-field__hint" role="status">
        {status === 'loading' ? 'Searching addresses…' : null}
        {focused && !dismissed && status === 'error' ? 'Search is unavailable. You can still enter your address manually.' : null}
        {focused && !dismissed && status === 'ready' && suggestions.length === 0 ? 'No matching address found. Keep typing or enter it manually.' : null}
      </p>
      {open
        ? (
            <p className="onboarding-field__hint">
              Address search by Photon ·
              {' '}
              <a href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">© OpenStreetMap contributors</a>
            </p>
          )
        : null}
    </div>
  );
}
