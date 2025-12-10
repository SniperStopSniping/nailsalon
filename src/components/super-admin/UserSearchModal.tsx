'use client';

import { X, Search, User, Check } from 'lucide-react';
import { useState, useCallback } from 'react';

// =============================================================================
// Types
// =============================================================================

interface ClerkUser {
  id: string;
  email: string | null;
  name: string | null;
}

interface UserSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (user: ClerkUser) => void;
  currentOwnerEmail?: string | null;
}

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
    if (!query.trim()) return;

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Search Users</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="p-2 -m-2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Current Owner */}
            {currentOwnerEmail && (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg text-sm">
                <span className="text-gray-500">Current owner:</span>{' '}
                <span className="font-medium text-gray-900">{currentOwnerEmail}</span>
              </div>
            )}

            {/* Search Form */}
            <form onSubmit={handleSubmit} className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by email or name..."
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="mt-2 w-full px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Searching...' : 'Search'}
              </button>
            </form>

            {/* Error */}
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}

            {/* Results */}
            {results.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Results ({results.length})
                </div>
                {results.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => handleSelect(user)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                      selectedUser?.id === user.id
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                      <User className="w-5 h-5 text-gray-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate">
                        {user.name || 'No name'}
                      </div>
                      <div className="text-sm text-gray-500 truncate">
                        {user.email || 'No email'}
                      </div>
                    </div>
                    {selectedUser?.id === user.id && (
                      <Check className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Empty State */}
            {!loading && results.length === 0 && query && (
              <div className="text-center py-8 text-gray-500 text-sm">
                No users found matching "{query}"
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
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
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Select User
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
