'use client';

import { Check, Search, User, X } from 'lucide-react';
import { useCallback, useState } from 'react';

// =============================================================================
// Types
// =============================================================================

type ClerkUser = {
  id: string;
  email: string | null;
  name: string | null;
};

type UserSearchModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (user: ClerkUser) => void;
  currentOwnerEmail?: string | null;
};

// =============================================================================
// Component
// =============================================================================

export function UserSearchModal({ isOpen, onClose, onSelect, currentOwnerEmail }: UserSearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ClerkUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<ClerkUser | null>(null);

  const searchUsers = useCallback(async () => {
    if (!query.trim()) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/super-admin/users/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) {
        throw new Error('Failed to search users');
      }

      const data = await response.json();
      setResults(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    searchUsers();
  };

  const handleSelect = (user: ClerkUser) => {
    setSelectedUser(user);
  };

  const handleConfirm = () => {
    if (selectedUser) {
      onSelect(selectedUser);
      onClose();
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Search Users</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="-m-2 p-2 text-gray-400 hover:text-gray-600"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Current Owner */}
            {currentOwnerEmail && (
              <div className="mb-4 rounded-lg bg-gray-50 p-3 text-sm">
                <span className="text-gray-500">Current owner:</span>
                {' '}
                <span className="font-medium text-gray-900">{currentOwnerEmail}</span>
              </div>
            )}

            {/* Search Form */}
            <form onSubmit={handleSubmit} className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search by email or name..."
                  className="w-full rounded-lg border border-gray-200 py-2.5 pl-10 pr-4 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="mt-2 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Searching...' : 'Search'}
              </button>
            </form>

            {/* Error */}
            {error && (
              <div className="mb-4 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Results */}
            {results.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
                  Results (
                  {results.length}
                  )
                </div>
                {results.map(user => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => handleSelect(user)}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      selectedUser?.id === user.id
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gray-100">
                      <User className="size-5 text-gray-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-gray-900">
                        {user.name || 'No name'}
                      </div>
                      <div className="truncate text-sm text-gray-500">
                        {user.email || 'No email'}
                      </div>
                    </div>
                    {selectedUser?.id === user.id && (
                      <Check className="size-5 shrink-0 text-indigo-600" />
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Empty State */}
            {!loading && results.length === 0 && query && (
              <div className="py-8 text-center text-sm text-gray-500">
                No users found matching "
                {query}
                "
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!selectedUser}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Select User
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
