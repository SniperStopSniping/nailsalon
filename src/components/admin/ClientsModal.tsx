'use client';

/**
 * ClientsModal Component
 *
 * iOS Contacts-style client list modal.
 * Features:
 * - Searchable client list
 * - Alphabetical section headers
 * - Recent visits display
 * - Tap to view client details
 * - Pull from salon_client table (salon-scoped)
 */

import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Calendar, ChevronRight, Mail, Phone, Search, Star, User } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';

import { BackButton, ModalHeader } from './AppModal';

// Types
type ClientData = {
  id: string;
  phone: string;
  fullName: string | null;
  email: string | null;
  lastVisitAt: string | null;
  totalVisits: number;
  totalSpent: number;
  noShowCount: number;
  loyaltyPoints: number;
  preferredTechnician: {
    id: string;
    name: string;
    avatarUrl: string | null;
  } | null;
  notes: string | null;
};

type ClientsModalProps = {
  onClose: () => void;
};

// Format phone for display
function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

// Format currency
function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

// Group clients by first letter
function groupClientsByLetter(clients: ClientData[]): Map<string, ClientData[]> {
  const groups = new Map<string, ClientData[]>();

  for (const client of clients) {
    const name = client.fullName || 'Unknown';
    const letter = name.charAt(0).toUpperCase();
    const existing = groups.get(letter) || [];
    existing.push(client);
    groups.set(letter, existing);
  }

  // Sort groups alphabetically
  return new Map([...groups.entries()].sort());
}

/**
 * Search Bar Component
 */
function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="px-4 pb-3">
      <div className="bg-[#767680]/12 flex h-9 items-center gap-2 rounded-[10px] px-3">
        <Search className="size-4 text-[#8E8E93]" />
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Search clients"
          className="flex-1 bg-transparent text-[16px] text-[#1C1C1E] placeholder-[#8E8E93] outline-none"
        />
      </div>
    </div>
  );
}

/**
 * Client Row Component
 */
function ClientRow({
  client,
  isLast,
  onClick,
}: {
  client: ClientData;
  isLast: boolean;
  onClick: () => void;
}) {
  const name = client.fullName || 'Unknown';
  const initials = name.substring(0, 2).toUpperCase();

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex min-h-[60px] cursor-pointer items-center pl-4 transition-colors active:bg-gray-50"
      onClick={onClick}
    >
      {/* Avatar */}
      <div className="mr-3 flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-[#4facfe] to-[#00f2fe] text-[13px] font-bold text-white shadow-sm">
        {initials}
      </div>

      {/* Content */}
      <div className={`flex flex-1 items-center justify-between py-3 pr-4 ${!isLast ? 'border-b border-gray-100' : ''}`}>
        <div>
          <div className="flex items-center gap-1.5 text-[16px] font-medium text-[#1C1C1E]">
            {name}
            {client.noShowCount > 0 && (
              <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                {client.noShowCount}
                {' '}
                no-show
                {client.noShowCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[13px] text-[#8E8E93]">
            <Phone className="size-3" />
            {formatPhone(client.phone)}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="mr-2 text-right">
            <div className="text-[13px] text-[#8E8E93]">
              {client.totalVisits}
              {' '}
              visit
              {client.totalVisits !== 1 ? 's' : ''}
            </div>
            <div className="text-[12px] font-medium text-[#34C759]">
              {formatCurrency(client.totalSpent)}
            </div>
          </div>
          <ChevronRight className="size-4 text-[#C7C7CC]" />
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Section Header Component
 */
function SectionHeader({ letter }: { letter: string }) {
  return (
    <div className="sticky top-0 z-10 bg-[#F2F2F7] px-4 py-1">
      <span className="text-[13px] font-semibold text-[#8E8E93]">{letter}</span>
    </div>
  );
}

/**
 * Empty State Component
 */
function EmptyState({ searchQuery }: { searchQuery: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20">
      <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-[#F2F2F7]">
        <User className="size-8 text-[#8E8E93]" />
      </div>
      <h3 className="mb-1 text-[17px] font-semibold text-[#1C1C1E]">
        {searchQuery ? 'No Results' : 'No Clients Yet'}
      </h3>
      <p className="text-center text-[15px] text-[#8E8E93]">
        {searchQuery
          ? `No clients match "${searchQuery}"`
          : 'Clients will appear here after their first booking'}
      </p>
    </div>
  );
}

/**
 * Client Detail View Component
 */
function ClientDetail({
  client,
  onBack,
}: {
  client: ClientData;
  onBack: () => void;
}) {
  const name = client.fullName || 'Unknown';
  const initials = name.substring(0, 2).toUpperCase();

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="fixed inset-0 top-12 z-50 overflow-y-auto rounded-t-[20px] bg-[#F2F2F7]"
    >
      <ModalHeader
        title={name}
        leftAction={<BackButton onClick={onBack} label="Clients" />}
      />

      <div className="p-4 pb-10">
        {/* Profile Card */}
        <div className="mb-4 rounded-[22px] bg-white p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <div className="flex flex-col items-center">
            <div className="mb-3 flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-[#4facfe] to-[#00f2fe] text-2xl font-bold text-white shadow-lg">
              {initials}
            </div>
            <h2 className="text-[22px] font-semibold text-[#1C1C1E]">{name}</h2>
            <div className="mt-1 flex items-center gap-1 text-[15px] text-[#8E8E93]">
              <Phone className="size-3.5" />
              {formatPhone(client.phone)}
            </div>
            {client.email && (
              <div className="mt-0.5 flex items-center gap-1 text-[15px] text-[#8E8E93]">
                <Mail className="size-3.5" />
                {client.email}
              </div>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="text-[12px] font-medium uppercase text-[#8E8E93]">Total Visits</div>
            <div className="mt-1 text-[24px] font-bold text-[#1C1C1E]">
              {client.totalVisits}
            </div>
          </div>
          <div className="rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="text-[12px] font-medium uppercase text-[#8E8E93]">Total Spent</div>
            <div className="mt-1 text-[24px] font-bold text-[#34C759]">
              {formatCurrency(client.totalSpent)}
            </div>
          </div>
          <div className="rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="flex items-center gap-1 text-[12px] font-medium uppercase text-[#8E8E93]">
              <Star className="size-3" />
              Loyalty Points
            </div>
            <div className="mt-1 text-[24px] font-bold text-[#FF9500]">
              {client.loyaltyPoints.toLocaleString()}
            </div>
          </div>
          <div className="rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="flex items-center gap-1 text-[12px] font-medium uppercase text-[#8E8E93]">
              <AlertCircle className="size-3" />
              No-Shows
            </div>
            <div className={`mt-1 text-[24px] font-bold ${client.noShowCount > 0 ? 'text-[#FF3B30]' : 'text-[#1C1C1E]'}`}>
              {client.noShowCount}
            </div>
          </div>
        </div>

        {/* Preferred Technician */}
        {client.preferredTechnician && (
          <div className="mb-4 rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="mb-2 text-[12px] font-medium uppercase text-[#8E8E93]">Preferred Tech</div>
            <div className="flex items-center gap-3">
              {client.preferredTechnician.avatarUrl
                ? (
                    <img
                      src={client.preferredTechnician.avatarUrl}
                      alt={client.preferredTechnician.name}
                      className="size-10 rounded-full object-cover"
                    />
                  )
                : (
                    <div className="flex size-10 items-center justify-center rounded-full bg-[#007AFF] text-sm font-medium text-white">
                      {client.preferredTechnician.name.substring(0, 2).toUpperCase()}
                    </div>
                  )}
              <span className="text-[17px] font-medium text-[#1C1C1E]">
                {client.preferredTechnician.name}
              </span>
            </div>
          </div>
        )}

        {/* Last Visit */}
        {client.lastVisitAt && (
          <div className="mb-4 rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="mb-2 flex items-center gap-2 text-[12px] font-medium uppercase text-[#8E8E93]">
              <Calendar className="size-3.5" />
              Last Visit
            </div>
            <div className="text-[17px] text-[#1C1C1E]">
              {new Date(client.lastVisitAt).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </div>
          </div>
        )}

        {/* Notes */}
        {client.notes && (
          <div className="rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="mb-2 text-[12px] font-medium uppercase text-[#8E8E93]">Notes</div>
            <div className="whitespace-pre-wrap text-[15px] text-[#1C1C1E]">
              {client.notes}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Loading Skeleton
 */
function LoadingSkeleton() {
  return (
    <div className="animate-pulse">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="flex items-center px-4 py-3">
          <div className="mr-3 size-10 rounded-full bg-gray-200" />
          <div className="flex-1">
            <div className="mb-2 h-4 w-32 rounded bg-gray-200" />
            <div className="h-3 w-24 rounded bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ClientsModal({ onClose }: ClientsModalProps) {
  const { salonSlug } = useSalon();
  const [clients, setClients] = useState<ClientData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<ClientData | null>(null);
  const [totalClients, setTotalClients] = useState(0);

  // Fetch clients data from new salon-scoped API
  const fetchClients = useCallback(async (search?: string) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        salonSlug,
        sortBy: 'recent',
        limit: '100',
      });
      if (search) {
        params.set('search', search);
      }

      const response = await fetch(`/api/admin/clients?${params}`);
      if (response.ok) {
        const result = await response.json();
        const fetchedClients = result.data?.clients || [];
        setClients(fetchedClients);
        setTotalClients(result.data?.pagination?.total || fetchedClients.length);
      }
    } catch (error) {
      console.error('Failed to fetch clients:', error);
    } finally {
      setLoading(false);
    }
  }, [salonSlug]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery) {
        fetchClients(searchQuery);
      } else {
        fetchClients();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchClients]);

  // Group clients by first letter (already filtered by API)
  const groupedClients = groupClientsByLetter(clients);

  return (
    <div className="relative flex min-h-full w-full flex-col bg-[#F2F2F7] font-sans text-black">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title="Clients"
          subtitle={`${totalClients} total`}
          leftAction={<BackButton onClick={onClose} label="Back" />}
        />
        <SearchBar value={searchQuery} onChange={setSearchQuery} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-10">
        {loading
          ? (
              <LoadingSkeleton />
            )
          : clients.length === 0
            ? (
                <EmptyState searchQuery={searchQuery} />
              )
            : (
                Array.from(groupedClients.entries()).map(([letter, letterClients]) => (
                  <div key={letter}>
                    <SectionHeader letter={letter} />
                    <div className="mx-4 mb-2 overflow-hidden rounded-[10px] bg-white shadow-sm">
                      {letterClients.map((client, index) => (
                        <ClientRow
                          key={client.id}
                          client={client}
                          isLast={index === letterClients.length - 1}
                          onClick={() => setSelectedClient(client)}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
      </div>

      {/* Client Detail Overlay */}
      <AnimatePresence>
        {selectedClient && (
          <ClientDetail
            client={selectedClient}
            onBack={() => setSelectedClient(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
