export type StaffAppointmentData = {
  id: string;
  clientName: string | null;
  clientPhone: string;
  startTime: string;
  endTime: string;
  status: string;
  technicianId: string | null;
  services: Array<{ name: string }>;
  totalPrice: number;
  totalDurationMinutes?: number;
  locationId?: string | null;
  photos: Array<{
    id: string;
    imageUrl: string;
    thumbnailUrl: string | null;
    photoType: string;
  }>;
};

export type PaymentMethod = 'cash' | 'card' | 'e-transfer';
