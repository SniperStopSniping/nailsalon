import type { Meta, StoryObj } from '@storybook/react';

import { SalonProvider } from '@/providers/SalonProvider';

import { BookTimeClient } from './BookTimeClient';

type AvailabilityStoryParameters = {
  bookedSlots?: string[];
  slots: string[];
};

const meta = {
  title: 'Booking/Available Times',
  component: BookTimeClient,
  decorators: [
    (Story, context) => {
      const availability = context.parameters.availability as AvailabilityStoryParameters;
      window.fetch = async () => new Response(JSON.stringify({
        blockedDurationMinutes: 70,
        bookedSlots: availability.bookedSlots ?? [],
        visibleDurationMinutes: 60,
        visibleSlots: availability.slots,
      }), { status: 200 });

      return (
        <SalonProvider
          salonId="salon_review"
          salonName="Luster Nail Studio"
          salonSlug="luster-review"
          status="active"
        >
          <Story />
        </SalonProvider>
      );
    },
  ],
  args: {
    bookingFlow: ['service', 'tech', 'time', 'confirm'],
    services: [{ id: 'service_review', name: 'Structured Gel Manicure', price: 75, duration: 60 }],
    technician: { id: 'tech_review', imageUrl: null, name: 'Maya' },
    totalDuration: 60,
    totalPrice: 75,
  },
  parameters: {
    layout: 'fullscreen',
    nextjs: {
      navigation: {
        pathname: '/en/luster-review/book/time',
        query: {
          date: '2026-09-12',
          serviceIds: 'service_review',
          techId: 'tech_review',
        },
      },
    },
  },
} satisfies Meta<typeof BookTimeClient>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneAvailableTime = {
  parameters: {
    availability: {
      bookedSlots: ['11:00', '11:15', '15:45'],
      slots: ['11:00', '11:15', '13:45', '15:45'],
    },
  },
} satisfies Story;

export const ThreeAvailableTimes = {
  parameters: {
    availability: {
      slots: ['09:30', '13:45', '18:15'],
    },
  },
} satisfies Story;

export const ManyAvailableTimes = {
  parameters: {
    availability: {
      slots: ['09:00', '09:30', '10:15', '11:00', '13:00', '13:45', '14:30', '16:15', '17:00', '18:15', '19:00'],
    },
  },
} satisfies Story;

export const ZeroAvailableTimes = {
  parameters: {
    availability: {
      bookedSlots: ['11:00', '13:45'],
      slots: ['11:00', '13:45'],
    },
  },
} satisfies Story;
