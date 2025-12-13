'use client';

/**
 * PageThemesSettings Component
 *
 * Admin UI section for configuring per-page theme settings.
 * Allows toggling between "Custom" (no theme) and "Use Theme" modes,
 * and selecting which theme to apply when in theme mode.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Loader2, Paintbrush } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { THEMEABLE_PAGES } from '@/models/Schema';

// Available themes from the registry
const AVAILABLE_THEMES = [
  { key: 'espresso', name: 'Espresso', description: 'Dark coffee with gold accents' },
  { key: 'lavender', name: 'Lavender', description: 'Soft purple with violet accents' },
  { key: 'pastel', name: 'Pastel', description: 'Light ivory with gold accents' },
] as const;

// Page display names for better UI
const PAGE_DISPLAY_NAMES: Record<string, string> = {
  'rewards': 'Rewards',
  'profile': 'Profile',
  'gallery': 'Gallery',
  'book-service': 'Book Service',
  'book-technician': 'Book Technician',
  'book-datetime': 'Book Date/Time',
  'book-confirm': 'Book Confirm',
  'preferences': 'Preferences',
  'invite': 'Invite',
};

type PageAppearance = {
  pageName: string;
  mode: 'custom' | 'theme';
  themeKey: string | null;
};

type ThemeDropdownProps = {
  themeKey: string | null;
  onChange: (themeKey: string) => void;
  disabled?: boolean;
};

function ThemeDropdown({ themeKey, onChange, disabled }: ThemeDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedTheme = AVAILABLE_THEMES.find(t => t.key === themeKey) || AVAILABLE_THEMES[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          flex w-full items-center justify-between rounded-lg px-3 py-2
          text-sm font-medium transition-all
          ${disabled
      ? 'cursor-not-allowed bg-gray-100 text-gray-400'
      : 'border border-gray-200 bg-white text-gray-900 hover:border-gray-300'
    }
        `}
      >
        <span>{selectedTheme?.name || 'Select Theme'}</span>
        <ChevronDown className={`size-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && !disabled && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
          >
            {AVAILABLE_THEMES.map(theme => (
              <button
                key={theme.key}
                type="button"
                onClick={() => {
                  onChange(theme.key);
                  setIsOpen(false);
                }}
                className={`
                  flex w-full items-center justify-between px-3 py-2 text-left
                  transition-colors hover:bg-gray-50
                  ${themeKey === theme.key ? 'bg-gray-50' : ''}
                `}
              >
                <div>
                  <div className="text-sm font-medium text-gray-900">{theme.name}</div>
                  <div className="text-xs text-gray-500">{theme.description}</div>
                </div>
                {themeKey === theme.key && (
                  <Check className="size-4 text-green-500" />
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type ToggleSwitchProps = {
  isOn: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label?: string;
};

function ToggleSwitch({ isOn, onChange, disabled, label }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!isOn)}
      disabled={disabled}
      aria-label={label || (isOn ? 'Disable' : 'Enable')}
      className={`
        relative h-7 w-12 rounded-full p-0.5 transition-colors duration-300
        ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
        ${isOn ? 'bg-[#34C759]' : 'bg-[#E9E9EA]'}
      `}
    >
      <motion.div
        animate={{ x: isOn ? 20 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="size-6 rounded-full bg-white shadow-md"
      />
    </button>
  );
}

type PageThemesSettingsProps = {
  className?: string;
};

export function PageThemesSettings({ className = '' }: PageThemesSettingsProps) {
  const [pages, setPages] = useState<PageAppearance[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch current settings
  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/salon/page-appearance');
      if (response.ok) {
        const data = await response.json();
        setPages(data.pages || []);
      }
    } catch (err) {
      console.error('Failed to fetch page appearances:', err);
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Update page settings
  const updatePage = async (pageName: string, mode: 'custom' | 'theme', themeKey?: string) => {
    setSaving(pageName);
    setError(null);

    try {
      const response = await fetch('/api/salon/page-appearance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageName,
          mode,
          themeKey: mode === 'theme' ? (themeKey || 'espresso') : null,
        }),
      });

      if (response.ok) {
        // Update local state
        setPages(prev => prev.map(p =>
          p.pageName === pageName
            ? { ...p, mode, themeKey: mode === 'theme' ? (themeKey || 'espresso') : null }
            : p,
        ));
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to save');
      }
    } catch (err) {
      console.error('Failed to update page appearance:', err);
      setError('Failed to save settings');
    } finally {
      setSaving(null);
    }
  };

  const handleModeToggle = (pageName: string, useTheme: boolean) => {
    const page = pages.find(p => p.pageName === pageName);
    const newMode = useTheme ? 'theme' : 'custom';
    const themeKey = useTheme ? (page?.themeKey || 'espresso') : null;
    updatePage(pageName, newMode, themeKey || undefined);
  };

  const handleThemeChange = (pageName: string, themeKey: string) => {
    updatePage(pageName, 'theme', themeKey);
  };

  if (loading) {
    return (
      <div className={`p-6 ${className}`}>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-6 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <div className={`${className}`}>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-purple-500">
          <Paintbrush className="size-4 text-white" />
        </div>
        <div>
          <h3 className="text-[16px] font-semibold text-gray-900">Page Themes</h3>
          <p className="text-[12px] text-gray-500">Customize appearance per page</p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Page List */}
      <div className="divide-y divide-gray-100">
        {THEMEABLE_PAGES.map((pageName) => {
          const page = pages.find(p => p.pageName === pageName) || {
            pageName,
            mode: 'custom' as const,
            themeKey: null,
          };
          const isThemeMode = page.mode === 'theme';
          const isSaving = saving === pageName;

          return (
            <div key={pageName} className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-medium text-gray-900">
                    {PAGE_DISPLAY_NAMES[pageName] || pageName}
                  </span>
                  {isSaving && (
                    <Loader2 className="size-4 animate-spin text-gray-400" />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-gray-500">
                    {isThemeMode ? 'Use Theme' : 'Custom'}
                  </span>
                  <ToggleSwitch
                    isOn={isThemeMode}
                    onChange={value => handleModeToggle(pageName, value)}
                    disabled={isSaving}
                    label={`${isThemeMode ? 'Disable' : 'Enable'} theme for ${PAGE_DISPLAY_NAMES[pageName] || pageName}`}
                  />
                </div>
              </div>

              {/* Theme selector - only visible when mode is 'theme' */}
              <AnimatePresence>
                {isThemeMode && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="pt-2">
                      <ThemeDropdown
                        themeKey={page.themeKey}
                        onChange={themeKey => handleThemeChange(pageName, themeKey)}
                        disabled={isSaving}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
        <p className="text-[12px] text-gray-500">
          Pages set to "Custom" will use their existing hardcoded styles.
          Pages set to "Use Theme" will dynamically apply the selected theme.
        </p>
      </div>
    </div>
  );
}
