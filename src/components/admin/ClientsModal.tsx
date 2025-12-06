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
 * - Pull from real client data
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Search, Phone, Calendar, ChevronRight, User } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';

import { ModalHeader, BackButton } from './AppModal';

// Types
interface ClientData {
  id: string;
  phone: string;
  firstName: string | null;
  lastVisit?: string;
  totalVisits?: number;
  totalSpent?: number;
}

interface ClientsModalProps {
  onClose: () => void;
}

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
    const name = client.firstName || 'Unknown';
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
  onChange 
}: { 
  value: string; 
  onChange: (value: string) => void;
}) {
  return (
    <div className="px-4 pb-3">
      <div className="h-9 bg-[#767680]/12 rounded-[10px] flex items-center px-3 gap-2">
        <Search className="w-4 h-4 text-[#8E8E93]" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
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
  onClick 
}: { 
  client: ClientData; 
  isLast: boolean;
  onClick: () => void;
}) {
  const name = client.firstName || 'Unknown';
  const initials = name.substring(0, 2).toUpperCase();
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-center pl-4 min-h-[60px] active:bg-gray-50 transition-colors cursor-pointer"
      onClick={onClick}
    >
      {/* Avatar */}
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#4facfe] to-[#00f2fe] flex items-center justify-center text-white text-[13px] font-bold mr-3 shadow-sm">
        {initials}
      </div>
      
      {/* Content */}
      <div className={`flex-1 flex items-center justify-between pr-4 py-3 ${!isLast ? 'border-b border-gray-100' : ''}`}>
        <div>
          <div className="text-[16px] font-medium text-[#1C1C1E]">{name}</div>
          <div className="text-[13px] text-[#8E8E93] flex items-center gap-1 mt-0.5">
            <Phone className="w-3 h-3" />
            {formatPhone(client.phone)}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {client.totalVisits !== undefined && (
            <div className="text-right mr-2">
              <div className="text-[13px] text-[#8E8E93]">
                {client.totalVisits} visits
              </div>
              {client.totalSpent !== undefined && (
                <div className="text-[12px] text-[#34C759] font-medium">
                  {formatCurrency(client.totalSpent)}
                </div>
              )}
            </div>
          )}
          <ChevronRight className="w-4 h-4 text-[#C7C7CC]" />
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
    <div className="sticky top-0 bg-[#F2F2F7] px-4 py-1 z-10">
      <span className="text-[13px] font-semibold text-[#8E8E93]">{letter}</span>
    </div>
  );
}

/**
 * Empty State Component
 */
function EmptyState({ searchQuery }: { searchQuery: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-8">
      <div className="w-16 h-16 rounded-full bg-[#F2F2F7] flex items-center justify-center mb-4">
        <User className="w-8 h-8 text-[#8E8E93]" />
      </div>
      <h3 className="text-[17px] font-semibold text-[#1C1C1E] mb-1">
        {searchQuery ? 'No Results' : 'No Clients Yet'}
      </h3>
      <p className="text-[15px] text-[#8E8E93] text-center">
        {searchQuery 
          ? `No clients match "${searchQuery}"`
          : 'Clients will appear here after their first booking'
        }
      </p>
    </div>
  );
}

/**
 * Client Detail View Component
 */
function ClientDetail({ 
  client, 
  onBack 
}: { 
  client: ClientData; 
  onBack: () => void;
}) {
  const name = client.firstName || 'Unknown';
  const initials = name.substring(0, 2).toUpperCase();
  
  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="absolute inset-0 bg-[#F2F2F7]"
    >
      <ModalHeader
        title={name}
        leftAction={<BackButton onClick={onBack} label="Clients" />}
      />
      
      <div className="p-4">
        {/* Profile Card */}
        <div className="bg-white rounded-[22px] p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-4">
          <div className="flex flex-col items-center">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#4facfe] to-[#00f2fe] flex items-center justify-center text-white text-2xl font-bold mb-3 shadow-lg">
              {initials}
            </div>
            <h2 className="text-[22px] font-semibold text-[#1C1C1E]">{name}</h2>
            <p className="text-[15px] text-[#8E8E93] mt-1">{formatPhone(client.phone)}</p>
          </div>
        </div>
        
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="text-[13px] text-[#8E8E93] uppercase font-medium">Total Visits</div>
            <div className="text-[28px] font-bold text-[#1C1C1E] mt-1">
              {client.totalVisits || 0}
            </div>
          </div>
          <div className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="text-[13px] text-[#8E8E93] uppercase font-medium">Total Spent</div>
            <div className="text-[28px] font-bold text-[#34C759] mt-1">
              {formatCurrency(client.totalSpent || 0)}
            </div>
          </div>
        </div>
        
        {/* Last Visit */}
        {client.lastVisit && (
          <div className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="flex items-center gap-2 text-[13px] text-[#8E8E93] uppercase font-medium mb-2">
              <Calendar className="w-4 h-4" />
              Last Visit
            </div>
            <div className="text-[17px] text-[#1C1C1E]">
              {new Date(client.lastVisit).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
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
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center px-4 py-3">
          <div className="w-10 h-10 rounded-full bg-gray-200 mr-3" />
          <div className="flex-1">
            <div className="h-4 bg-gray-200 rounded w-32 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ClientsModal({ onClose }: ClientsModalProps) {
  const [clients, setClients] = useState<ClientData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<ClientData | null>(null);

  // Fetch clients data
  const fetchClients = useCallback(async () => {
    try {
      setLoading(true);
      // Fetch from appointments to get unique clients with their stats
      const response = await fetch('/api/appointments?date=all&status=completed,confirmed,pending,in_progress');
      if (response.ok) {
        const result = await response.json();
        const appointments = result.data?.appointments || [];
        
        // Aggregate client data from appointments
        const clientMap = new Map<string, ClientData>();
        
        for (const appt of appointments) {
          const phone = appt.clientPhone;
          const existing = clientMap.get(phone);
          
          if (existing) {
            existing.totalVisits = (existing.totalVisits || 0) + 1;
            existing.totalSpent = (existing.totalSpent || 0) + (appt.totalPrice || 0);
            if (!existing.lastVisit || new Date(appt.startTime) > new Date(existing.lastVisit)) {
              existing.lastVisit = appt.startTime;
            }
            if (appt.clientName && !existing.firstName) {
              existing.firstName = appt.clientName;
            }
          } else {
            clientMap.set(phone, {
              id: phone,
              phone,
              firstName: appt.clientName || null,
              lastVisit: appt.startTime,
              totalVisits: 1,
              totalSpent: appt.totalPrice || 0,
            });
          }
        }
        
        setClients(Array.from(clientMap.values()));
      }
    } catch (error) {
      console.error('Failed to fetch clients:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  // Filter clients by search query
  const filteredClients = clients.filter((client) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const name = (client.firstName || '').toLowerCase();
    const phone = client.phone.replace(/\D/g, '');
    return name.includes(query) || phone.includes(query.replace(/\D/g, ''));
  });

  // Group filtered clients
  const groupedClients = groupClientsByLetter(filteredClients);

  return (
    <div className="min-h-full w-full bg-[#F2F2F7] text-black font-sans flex flex-col relative">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title="Clients"
          subtitle={`${clients.length} total`}
          leftAction={<BackButton onClick={onClose} label="Back" />}
        />
        <SearchBar value={searchQuery} onChange={setSearchQuery} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-10">
        {loading ? (
          <LoadingSkeleton />
        ) : filteredClients.length === 0 ? (
          <EmptyState searchQuery={searchQuery} />
        ) : (
          Array.from(groupedClients.entries()).map(([letter, letterClients]) => (
            <div key={letter}>
              <SectionHeader letter={letter} />
              <div className="bg-white mx-4 rounded-[10px] overflow-hidden shadow-sm mb-2">
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

