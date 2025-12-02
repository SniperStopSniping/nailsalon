"use client";

import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageLayout } from "@/components/PageLayout";
import { MainCard } from "@/components/MainCard";
import { SummaryRow } from "@/components/SummaryRow";

type Appointment = {
  id: string;
  date: string;
  service: string;
  tech: string;
  time: string;
  status: "completed" | "cancelled" | "no-show";
  originalPrice: number;
  rewardDiscount?: number;
  finalPrice: number;
};

const APPOINTMENT_HISTORY: Appointment[] = [
  {
    id: "1",
    date: "Dec 18, 2025",
    service: "BIAB Refill",
    tech: "Tiffany",
    time: "2:00 PM",
    status: "completed",
    originalPrice: 65,
    rewardDiscount: 5,
    finalPrice: 60,
  },
  {
    id: "2",
    date: "Nov 15, 2025",
    service: "BIAB French",
    tech: "Daniela",
    time: "11:00 AM",
    status: "completed",
    originalPrice: 75,
    rewardDiscount: 10,
    finalPrice: 65,
  },
  {
    id: "3",
    date: "Oct 20, 2025",
    service: "Gel-X Extensions",
    tech: "Jenny",
    time: "3:30 PM",
    status: "completed",
    originalPrice: 90,
    finalPrice: 90,
  },
  {
    id: "4",
    date: "Sep 25, 2025",
    service: "BIAB Medium",
    tech: "Tiffany",
    time: "1:00 PM",
    status: "cancelled",
    originalPrice: 75,
    finalPrice: 0,
  },
  {
    id: "5",
    date: "Aug 30, 2025",
    service: "Gel Manicure",
    tech: "Daniela",
    time: "10:30 AM",
    status: "completed",
    originalPrice: 45,
    finalPrice: 45,
  },
  {
    id: "6",
    date: "Jul 15, 2025",
    service: "BIAB Short",
    tech: "Jenny",
    time: "2:00 PM",
    status: "completed",
    originalPrice: 65,
    rewardDiscount: 5,
    finalPrice: 60,
  },
];

export default function AppointmentHistoryPage() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const t = useTranslations("AppointmentHistory");

  const handleBack = () => {
    router.back();
  };

  const getStatusColor = (status: Appointment["status"]) => {
    switch (status) {
      case "completed":
        return "text-green-600 bg-green-50";
      case "cancelled":
        return "text-red-600 bg-red-50";
      case "no-show":
        return "text-orange-600 bg-orange-50";
      default:
        return "text-neutral-600 bg-neutral-50";
    }
  };

  const getStatusLabel = (status: Appointment["status"]) => {
    switch (status) {
      case "completed":
        return t("completed");
      case "cancelled":
        return t("cancelled");
      case "no-show":
        return t("no_show");
      default:
        return status;
    }
  };

  return (
    <PageLayout>
      {/* Top bar with back button */}
      <div className="pt-2 relative flex items-center">
        <button
          type="button"
          onClick={handleBack}
          className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-white/50 active:scale-95 transition-all duration-150 z-10"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12.5 15L7.5 10L12.5 5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div className="absolute left-1/2 transform -translate-x-1/2 text-xl font-semibold text-[#7b4ea3]">
          Nail Salon No.5
        </div>
      </div>

      {/* Title section */}
      <div className="text-center pt-2">
        <h1 className="text-3xl font-semibold text-[#7b4ea3]">
          {t("title")}
        </h1>
        <p className="text-sm text-neutral-600 mt-1">{t("subtitle")}</p>
      </div>

      {/* Appointment History List */}
      <div className="space-y-4">
        {APPOINTMENT_HISTORY.map((appointment) => (
          <MainCard key={appointment.id}>
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="text-base font-semibold text-neutral-900">
                  {appointment.date}
                </div>
                <div className="text-xs text-neutral-600 mt-0.5">
                  {appointment.time}
                </div>
              </div>
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-semibold ${getStatusColor(
                  appointment.status
                )}`}
              >
                {getStatusLabel(appointment.status)}
              </span>
            </div>

            <div className="space-y-2 mb-3">
              <div className="text-base font-semibold text-neutral-900">
                {appointment.service}
              </div>
              <div className="text-sm text-neutral-600">
                {t("tech")}: {appointment.tech}
              </div>
            </div>

            {appointment.status === "completed" && (
              <div className="border-t border-neutral-100 pt-3 space-y-2">
                <SummaryRow
                  label={t("price")}
                  value={`$${appointment.originalPrice}`}
                />
                {appointment.rewardDiscount && (
                  <SummaryRow
                    label={t("reward_applied")}
                    value={
                      <span className="text-green-600">
                        -${appointment.rewardDiscount}
                      </span>
                    }
                  />
                )}
                <div className="flex justify-between items-center pt-2 border-t border-neutral-100">
                  <span className="text-[18px] font-bold text-neutral-900">
                    {t("total_paid")}
                  </span>
                  <span className="text-[18px] font-bold text-neutral-900">
                    ${appointment.finalPrice}
                  </span>
                </div>
              </div>
            )}

            {appointment.status === "cancelled" && (
              <div className="border-t border-neutral-100 pt-3">
                <div className="text-xs text-neutral-500">
                  {t("this_appointment_cancelled")}
                </div>
              </div>
            )}
          </MainCard>
        ))}
      </div>

      {APPOINTMENT_HISTORY.length === 0 && (
        <MainCard>
          <div className="text-center py-8">
            <p className="text-sm text-neutral-600">{t("no_history")}</p>
          </div>
        </MainCard>
      )}
    </PageLayout>
  );
}
