'use client';

/**
 * MarketingModal Component
 *
 * iOS-style marketing/SMS campaign modal.
 * Features:
 * - Campaign templates
 * - SMS sending interface
 * - Campaign history
 * - Placeholder for future expansion
 */

import { motion } from 'framer-motion';
import { 
  MessageSquare, 
  Send, 
  Clock,
  Users,
  Sparkles,
  Gift,
  Calendar,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';

import { ModalHeader, BackButton } from './AppModal';

interface MarketingModalProps {
  onClose: () => void;
}

// Campaign template types
interface CampaignTemplate {
  id: string;
  name: string;
  description: string;
  icon: typeof MessageSquare;
  iconColor: string;
  message: string;
}

// Pre-built campaign templates
const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    id: 'reminder',
    name: 'Appointment Reminder',
    description: 'Remind clients of upcoming appointments',
    icon: Calendar,
    iconColor: 'from-[#4facfe] to-[#00f2fe]',
    message: "Hi {name}! Just a reminder about your appointment tomorrow at {time}. We can't wait to see you! 💅",
  },
  {
    id: 'promo',
    name: 'Special Promotion',
    description: 'Announce discounts and special offers',
    icon: Gift,
    iconColor: 'from-[#f093fb] to-[#f5576c]',
    message: "🎉 Special offer just for you! Get 20% off your next visit when you book this week. Use code SAVE20. Book now!",
  },
  {
    id: 'referral',
    name: 'Referral Program',
    description: 'Encourage clients to refer friends',
    icon: Users,
    iconColor: 'from-[#43e97b] to-[#38f9d7]',
    message: "Love our services? Refer a friend and you BOTH get a free gel manicure! 💖 Share your referral link today.",
  },
  {
    id: 'winback',
    name: 'Win-Back Campaign',
    description: 'Re-engage inactive clients',
    icon: Sparkles,
    iconColor: 'from-[#fa709a] to-[#fee140]',
    message: "We miss you! 💕 It's been a while since your last visit. Come back and enjoy 15% off your next service.",
  },
];

// Recent campaign history (mock data)
interface CampaignHistory {
  id: string;
  templateName: string;
  sentAt: string;
  recipientCount: number;
  status: 'sent' | 'scheduled' | 'draft';
}

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
  onClick 
}: { 
  template: CampaignTemplate; 
  onClick: () => void;
}) {
  const Icon = template.icon;
  
  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] cursor-pointer active:bg-gray-50 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div className={`w-12 h-12 rounded-[12px] bg-gradient-to-br ${template.iconColor} flex items-center justify-center shadow-sm flex-shrink-0`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[17px] font-semibold text-[#1C1C1E]">{template.name}</h3>
          <p className="text-[13px] text-[#8E8E93] mt-0.5">{template.description}</p>
        </div>
        <ChevronRight className="w-5 h-5 text-[#C7C7CC] flex-shrink-0 mt-1" />
      </div>
    </motion.div>
  );
}

/**
 * History Row Component
 */
function HistoryRow({ 
  campaign, 
  isLast 
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
        <div className="text-[13px] text-[#8E8E93] flex items-center gap-2 mt-0.5">
          <Clock className="w-3 h-3" />
          {formattedDate} at {formattedTime}
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
      className="absolute inset-0 bg-[#F2F2F7] overflow-y-auto"
    >
      <ModalHeader
        title="Compose Message"
        leftAction={<BackButton onClick={onClose} label="Cancel" />}
        rightAction={
          <button
            type="button"
            onClick={onSend}
            className="text-[#007AFF] text-[17px] font-semibold active:opacity-50 transition-opacity"
          >
            Send
          </button>
        }
      />
      
      <div className="p-4">
        {/* Template Header */}
        <div className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-[10px] bg-gradient-to-br ${template.iconColor} flex items-center justify-center`}>
              <Icon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-[17px] font-semibold text-[#1C1C1E]">{template.name}</h3>
              <p className="text-[13px] text-[#8E8E93]">{template.description}</p>
            </div>
          </div>
        </div>
        
        {/* Message Editor */}
        <div className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-4">
          <div className="text-[13px] text-[#8E8E93] uppercase font-medium mb-2">Message</div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full h-32 text-[16px] text-[#1C1C1E] bg-transparent resize-none outline-none"
            placeholder="Type your message..."
          />
          <div className="text-[12px] text-[#8E8E93] text-right mt-2">
            {message.length} / 160 characters
          </div>
        </div>
        
        {/* Recipients */}
        <div className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] text-[#8E8E93] uppercase font-medium">Recipients</div>
              <div className="text-[17px] font-semibold text-[#1C1C1E] mt-1">All Clients</div>
            </div>
            <div className="flex items-center gap-2 text-[#007AFF]">
              <Users className="w-5 h-5" />
              <span className="text-[17px] font-medium">48</span>
            </div>
          </div>
        </div>
        
        {/* Preview */}
        <div className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <div className="text-[13px] text-[#8E8E93] uppercase font-medium mb-3">Preview</div>
          <div className="bg-[#34C759] rounded-[18px] rounded-bl-[4px] p-3 max-w-[80%]">
            <p className="text-[15px] text-white leading-relaxed">
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
      className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-[22px] p-6 mx-8 shadow-2xl text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#007AFF] to-[#5856D6] flex items-center justify-center mx-auto mb-4">
          <Send className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-[20px] font-semibold text-[#1C1C1E] mb-2">Coming Soon</h3>
        <p className="text-[15px] text-[#8E8E93] mb-4">
          SMS campaigns will be available in the next update. Stay tuned!
        </p>
        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 bg-[#007AFF] text-white rounded-[12px] text-[17px] font-semibold active:opacity-80 transition-opacity"
        >
          Got It
        </button>
      </motion.div>
    </motion.div>
  );
}

export function MarketingModal({ onClose }: MarketingModalProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<CampaignTemplate | null>(null);
  const [showComingSoon, setShowComingSoon] = useState(false);

  const handleTemplateClick = (template: CampaignTemplate) => {
    setSelectedTemplate(template);
  };

  const handleSend = () => {
    setSelectedTemplate(null);
    setShowComingSoon(true);
  };

  return (
    <div className="min-h-full w-full bg-[#F2F2F7] text-black font-sans flex flex-col relative">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title="Marketing"
          subtitle="SMS Campaigns"
          leftAction={<BackButton onClick={onClose} label="Back" />}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-10 px-4">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="flex items-center gap-2 text-[13px] text-[#8E8E93] uppercase font-medium">
              <MessageSquare className="w-4 h-4" />
              Sent This Month
            </div>
            <div className="text-[28px] font-bold text-[#1C1C1E] mt-1">85</div>
          </div>
          <div className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="flex items-center gap-2 text-[13px] text-[#8E8E93] uppercase font-medium">
              <Users className="w-4 h-4" />
              Total Clients
            </div>
            <div className="text-[28px] font-bold text-[#007AFF] mt-1">48</div>
          </div>
        </div>

        {/* Campaign Templates */}
        <div className="mb-6">
          <h2 className="text-[13px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-3 px-1">
            Campaign Templates
          </h2>
          <div className="space-y-3">
            {CAMPAIGN_TEMPLATES.map((template) => (
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
          <h2 className="text-[13px] font-semibold text-[#8E8E93] uppercase tracking-wide mb-3 px-1">
            Recent Campaigns
          </h2>
          <div className="bg-white rounded-[16px] overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
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

