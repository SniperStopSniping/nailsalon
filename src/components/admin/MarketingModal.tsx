'use client';

/**
 * MarketingModal Component
 *
 * iOS-style marketing/SMS campaign modal.
 * Features:
 * - Campaign templates
 * - SMS sending interface
 * - Real client count from API
 * - Campaign history (Coming Soon)
 */

import { motion } from 'framer-motion';
import {
  Calendar,
  ChevronRight,
  Clock,
  Gift,
  MessageSquare,
  Send,
  Sparkles,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';

import { BackButton, ModalHeader } from './AppModal';

type MarketingModalProps = {
  onClose: () => void;
};

// Campaign template types
type CampaignTemplate = {
  id: string;
  name: string;
  description: string;
  icon: typeof MessageSquare;
  iconColor: string;
  message: string;
};

// Pre-built campaign templates
const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    id: 'reminder',
    name: 'Appointment Reminder',
    description: 'Remind clients of upcoming appointments',
    icon: Calendar,
    iconColor: 'from-[#4facfe] to-[#00f2fe]',
    message: 'Hi {name}! Just a reminder about your appointment tomorrow at {time}. We can\'t wait to see you! 💅',
  },
  {
    id: 'promo',
    name: 'Special Promotion',
    description: 'Announce discounts and special offers',
    icon: Gift,
    iconColor: 'from-[#f093fb] to-[#f5576c]',
    message: '🎉 Special offer just for you! Get 20% off your next visit when you book this week. Use code SAVE20. Book now!',
  },
  {
    id: 'referral',
    name: 'Referral Program',
    description: 'Encourage clients to refer friends',
    icon: Users,
    iconColor: 'from-[#43e97b] to-[#38f9d7]',
    message: 'Love our services? Refer a friend and you BOTH get a free gel manicure! 💖 Share your referral link today.',
  },
  {
    id: 'winback',
    name: 'Win-Back Campaign',
    description: 'Re-engage inactive clients',
    icon: Sparkles,
    iconColor: 'from-[#fa709a] to-[#fee140]',
    message: 'We miss you! 💕 It\'s been a while since your last visit. Come back and enjoy 15% off your next service.',
  },
];

// Recent campaign history (mock data)
type CampaignHistory = {
  id: string;
  templateName: string;
  sentAt: string;
  recipientCount: number;
  status: 'sent' | 'scheduled' | 'draft';
};

const CAMPAIGN_HISTORY: CampaignHistory[] = [
  { id: '1', templateName: 'Appointment Reminder', sentAt: '2025-12-05T10:00:00', recipientCount: 12, status: 'sent' },
  { id: '2', templateName: 'Special Promotion', sentAt: '2025-12-03T14:30:00', recipientCount: 45, status: 'sent' },
  { id: '3', templateName: 'Referral Program', sentAt: '2025-12-01T09:00:00', recipientCount: 28, status: 'sent' },
];

/**
 * Template Card Component
 */
function TemplateCard({
  template,
  onClick,
}: {
  template: CampaignTemplate;
  onClick: () => void;
}) {
  const Icon = template.icon;

  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      className="cursor-pointer rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] transition-colors active:bg-gray-50"
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div className={`size-12 rounded-[12px] bg-gradient-to-br ${template.iconColor} flex shrink-0 items-center justify-center shadow-sm`}>
          <Icon className="size-6 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-semibold text-[#1C1C1E]">{template.name}</h3>
          <p className="mt-0.5 text-[13px] text-[#8E8E93]">{template.description}</p>
        </div>
        <ChevronRight className="mt-1 size-5 shrink-0 text-[#C7C7CC]" />
      </div>
    </motion.div>
  );
}

/**
 * History Row Component
 */
function HistoryRow({
  campaign,
  isLast,
}: {
  campaign: CampaignHistory;
  isLast: boolean;
}) {
  const sentDate = new Date(campaign.sentAt);
  const formattedDate = sentDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const formattedTime = sentDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <div className={`flex items-center justify-between px-4 py-3 ${!isLast ? 'border-b border-gray-100' : ''}`}>
      <div>
        <div className="text-[15px] font-medium text-[#1C1C1E]">{campaign.templateName}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[13px] text-[#8E8E93]">
          <Clock className="size-3" />
          {formattedDate}
          {' '}
          at
          {formattedTime}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[15px] font-medium text-[#1C1C1E]">{campaign.recipientCount}</div>
        <div className="text-[12px] text-[#8E8E93]">recipients</div>
      </div>
    </div>
  );
}

/**
 * Compose Modal Component
 */
function ComposeModal({
  template,
  onClose,
  onSend,
}: {
  template: CampaignTemplate;
  onClose: () => void;
  onSend: () => void;
}) {
  const [message, setMessage] = useState(template.message);
  const Icon = template.icon;

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="absolute inset-0 overflow-y-auto bg-[#F2F2F7]"
    >
      <ModalHeader
        title="Compose Message"
        leftAction={<BackButton onClick={onClose} label="Cancel" />}
        rightAction={(
          <button
            type="button"
            onClick={onSend}
            className="text-[17px] font-semibold text-[#007AFF] transition-opacity active:opacity-50"
          >
            Send
          </button>
        )}
      />

      <div className="p-4">
        {/* Template Header */}
        <div className="mb-4 rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <div className="flex items-center gap-3">
            <div className={`size-10 rounded-[10px] bg-gradient-to-br ${template.iconColor} flex items-center justify-center`}>
              <Icon className="size-5 text-white" />
            </div>
            <div>
              <h3 className="text-[17px] font-semibold text-[#1C1C1E]">{template.name}</h3>
              <p className="text-[13px] text-[#8E8E93]">{template.description}</p>
            </div>
          </div>
        </div>

        {/* Message Editor */}
        <div className="mb-4 rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <div className="mb-2 text-[13px] font-medium uppercase text-[#8E8E93]">Message</div>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            className="h-32 w-full resize-none bg-transparent text-[16px] text-[#1C1C1E] outline-none"
            placeholder="Type your message..."
          />
          <div className="mt-2 text-right text-[12px] text-[#8E8E93]">
            {message.length}
            {' '}
            / 160 characters
          </div>
        </div>

        {/* Recipients */}
        <div className="mb-4 rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] font-medium uppercase text-[#8E8E93]">Recipients</div>
              <div className="mt-1 text-[17px] font-semibold text-[#1C1C1E]">All Clients</div>
            </div>
            <div className="flex items-center gap-2 text-[#007AFF]">
              <Users className="size-5" />
              <span className="text-[17px] font-medium">48</span>
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <div className="mb-3 text-[13px] font-medium uppercase text-[#8E8E93]">Preview</div>
          <div className="max-w-[80%] rounded-[18px] rounded-bl-[4px] bg-[#34C759] p-3">
            <p className="text-[15px] leading-relaxed text-white">
              {message.replace('{name}', 'Sarah').replace('{time}', '2:00 PM')}
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Coming Soon Overlay
 */
function ComingSoonOverlay({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="mx-8 rounded-[22px] bg-white p-6 text-center shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-[#007AFF] to-[#5856D6]">
          <Send className="size-8 text-white" />
        </div>
        <h3 className="mb-2 text-[20px] font-semibold text-[#1C1C1E]">Coming Soon</h3>
        <p className="mb-4 text-[15px] text-[#8E8E93]">
          SMS campaigns will be available in the next update. Stay tuned!
        </p>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-[12px] bg-[#007AFF] py-3 text-[17px] font-semibold text-white transition-opacity active:opacity-80"
        >
          Got It
        </button>
      </motion.div>
    </motion.div>
  );
}

export function MarketingModal({ onClose }: MarketingModalProps) {
  const { salonSlug } = useSalon();
  const [selectedTemplate, setSelectedTemplate] = useState<CampaignTemplate | null>(null);
  const [showComingSoon, setShowComingSoon] = useState(false);
  const [totalClients, setTotalClients] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Fetch client count from API
  const fetchClientCount = useCallback(async () => {
    // Skip if already loaded
    if (hasLoaded) {
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`/api/admin/clients?salonSlug=${salonSlug}&limit=1`);
      if (response.ok) {
        const result = await response.json();
        setTotalClients(result.data?.pagination?.total || 0);
        setHasLoaded(true);
      }
    } catch (err) {
      console.error('Failed to fetch client count:', err);
    } finally {
      setLoading(false);
    }
  }, [salonSlug, hasLoaded]);

  useEffect(() => {
    fetchClientCount();
  }, [fetchClientCount]);

  const handleTemplateClick = (template: CampaignTemplate) => {
    setSelectedTemplate(template);
  };

  const handleSend = () => {
    setSelectedTemplate(null);
    setShowComingSoon(true);
  };

  return (
    <div className="relative flex min-h-full w-full flex-col bg-[#F2F2F7] font-sans text-black">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title="Marketing"
          subtitle="SMS Campaigns"
          leftAction={<BackButton onClick={onClose} label="Back" />}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-10">
        {/* Quick Stats */}
        <div className="mb-6 grid grid-cols-2 gap-4">
          <div className="rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="flex items-center gap-2 text-[13px] font-medium uppercase text-[#8E8E93]">
              <MessageSquare className="size-4" />
              Sent This Month
            </div>
            <div className="mt-1 text-[28px] font-bold text-[#1C1C1E]">
              <span className="text-[14px] font-normal text-[#8E8E93]">Coming Soon</span>
            </div>
          </div>
          <div className="rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="flex items-center gap-2 text-[13px] font-medium uppercase text-[#8E8E93]">
              <Users className="size-4" />
              Total Clients
            </div>
            <div className="mt-1 text-[28px] font-bold text-[#007AFF]">
              {loading ? '...' : totalClients}
            </div>
          </div>
        </div>

        {/* Campaign Templates */}
        <div className="mb-6">
          <h2 className="mb-3 px-1 text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
            Campaign Templates
          </h2>
          <div className="space-y-3">
            {CAMPAIGN_TEMPLATES.map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                onClick={() => handleTemplateClick(template)}
              />
            ))}
          </div>
        </div>

        {/* Recent Campaigns */}
        <div>
          <h2 className="mb-3 px-1 text-[13px] font-semibold uppercase tracking-wide text-[#8E8E93]">
            Recent Campaigns
          </h2>
          <div className="overflow-hidden rounded-[16px] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            {CAMPAIGN_HISTORY.map((campaign, index) => (
              <HistoryRow
                key={campaign.id}
                campaign={campaign}
                isLast={index === CAMPAIGN_HISTORY.length - 1}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Compose Modal */}
      {selectedTemplate && (
        <ComposeModal
          template={selectedTemplate}
          onClose={() => setSelectedTemplate(null)}
          onSend={handleSend}
        />
      )}

      {/* Coming Soon Overlay */}
      {showComingSoon && (
        <ComingSoonOverlay onClose={() => setShowComingSoon(false)} />
      )}
    </div>
  );
}
