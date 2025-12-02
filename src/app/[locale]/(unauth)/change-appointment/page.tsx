"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import Image from "next/image";
import { PageLayout } from "@/components/PageLayout";
import { MainCard } from "@/components/MainCard";
import { SectionTitle } from "@/components/SectionTitle";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SecondaryButton } from "@/components/SecondaryButton";

const SERVICES: Record<
  string,
  { name: string; price: number; duration: number }
> = {
  "biab-short": { name: "BIAB Short", price: 65, duration: 75 },
  "biab-medium": { name: "BIAB Medium", price: 75, duration: 90 },
  "gelx-extensions": { name: "Gel-X Extensions", price: 90, duration: 105 },
  "biab-french": { name: "BIAB French", price: 75, duration: 90 },
  "spa-pedi": { name: "SPA Pedicure", price: 60, duration: 60 },
  "gel-pedi": { name: "Gel Pedicure", price: 70, duration: 75 },
  "biab-gelx-combo": { name: "BIAB + Gel-X Combo", price: 130, duration: 150 },
  "mani-pedi": { name: "Classic Mani + Pedi", price: 95, duration: 120 },
};

const TECHNICIANS: Record<string, string> = {
  daniela: "Daniela",
  tiffany: "Tiffany",
  jenny: "Jenny",
};

const generateTimeSlots = () => {
  const slots: string[] = [];
  for (let hour = 9; hour < 18; hour++) {
    slots.push(`${hour}:00`);
    slots.push(`${hour}:30`);
  }
  return slots;
};

const generateCalendarDays = (year: number, month: number) => {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  const days: (Date | null)[] = [];

  for (let i = 0; i < startingDayOfWeek; i++) {
    days.push(null);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    days.push(new Date(year, month, day));
  }

  return days;
};

export default function ChangeAppointmentPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = (params?.locale as string) || "en";
  const serviceIdsParam = searchParams.get("serviceIds");
  const serviceIds = serviceIdsParam
    ? serviceIdsParam.split(",").filter((id) => id.trim() !== "")
    : [];
  const techId = searchParams.get("techId") || "";
  const currentDate = searchParams.get("date") || "";
  const currentTime = searchParams.get("time") || "";

  const selectedServices = serviceIds
    .map((id) => SERVICES[id.trim()])
    .filter(Boolean);
  const totalDuration = selectedServices.reduce(
    (sum, service) => sum + service.duration,
    0
  );
  const totalPrice = selectedServices.reduce(
    (sum, service) => sum + service.price,
    0
  );
  const techName = TECHNICIANS[techId] || "Not selected";
  const serviceNames =
    selectedServices.length > 0
      ? selectedServices.map((s) => s.name).join(", ")
      : "Not selected";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Initialize selected date from URL or default to today
  const initialDate = currentDate
    ? new Date(currentDate)
    : today;
  initialDate.setHours(0, 0, 0, 0);

  const [currentMonth, setCurrentMonth] = useState(initialDate.getMonth());
  const [currentYear, setCurrentYear] = useState(initialDate.getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date | null>(initialDate);
  const [selectedTime, setSelectedTime] = useState<string>(currentTime);
  const [goldBarVisible, setGoldBarVisible] = useState(false);

  useEffect(() => {
    setTimeout(() => setGoldBarVisible(true), 50);
  }, []);

  const timeSlots = generateTimeSlots();
  const calendarDays = generateCalendarDays(currentYear, currentMonth);

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const handleDateSelect = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date >= today) {
      setSelectedDate(date);
    }
  };

  const handleTimeSelect = (time: string) => {
    setSelectedTime(time);
  };

  const handleConfirm = () => {
    if (!selectedDate || !selectedTime) return;

    const dateStr = selectedDate.toISOString().split("T")[0];
    router.push(
      `/${locale}/book/confirm?serviceIds=${serviceIds.join(",")}&techId=${techId}&date=${dateStr}&time=${selectedTime}`
    );
  };

  const handleChangeService = () => {
    router.push(`/${locale}/book/service`);
  };

  const handleCancel = () => {
    router.push(`/${locale}/profile`);
  };

  const handleBack = () => {
    router.back();
  };

  const formatDate = (date: Date | null | string) => {
    if (!date) return "Not selected";
    const dateObj = typeof date === "string" ? new Date(date) : date;
    if (isNaN(dateObj.getTime())) return "Not selected";
    const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${daysOfWeek[dateObj.getDay()]}, ${months[dateObj.getMonth()]} ${dateObj.getDate()}`;
  };

  const formatTime = (timeString: string) => {
    if (!timeString) return "Not selected";
    const [hours, minutes] = timeString.split(":");
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const getTechImage = (techId: string) => {
    if (!techId) return null;
    return `/assets/images/tech-${techId}.jpeg`;
  };

  return (
    <PageLayout background="#f5e8d8">
      {/* Top bar with back button */}
      <div className="pt-2 pb-1 relative flex items-center">
        <button
          type="button"
          onClick={handleBack}
          className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-white/60 active:scale-95 transition-all duration-200 z-10"
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
          Change Appointment
        </div>
      </div>

      {/* Current Appointment Summary Card */}
      <div className="mt-4 mb-4">
        <div className="w-full rounded-2xl bg-gradient-to-br from-[#fff7ec] via-[#fef5e7] to-[#fdf2e4] border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.08)] overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-[#d6a249] to-[#f4b864]" />
          <div className="px-5 py-4">
            <div className="flex items-start gap-8">
              {/* Technician Photo */}
              {techId && getTechImage(techId) && (
                <div className="flex-shrink-0">
                  <div className="relative w-16 h-20 rounded-lg overflow-hidden border-2 border-[#d6a249]/30">
                    <Image
                      src={getTechImage(techId)!}
                      alt={techName}
                      fill
                      className="object-cover"
                    />
                  </div>
                </div>
              )}
              
              {/* Appointment Details */}
              <div className="flex-1 space-y-2">
                <div>
                  <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1">
                    Service
                  </div>
                  <div className="text-base font-semibold text-neutral-900">
                    {serviceNames || "Not selected"}
                  </div>
                </div>
                
                <div>
                  <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1">
                    Nail Tech
                  </div>
                  <div className="text-base font-semibold text-neutral-900">
                    {techName}
                  </div>
                </div>
                
                <div>
                  <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1">
                    Date & Time
                  </div>
                  <div className="text-base font-semibold text-neutral-900">
                    {selectedDate && selectedTime
                      ? `${formatDate(selectedDate)} · ${formatTime(selectedTime)}`
                      : selectedDate
                      ? `${formatDate(selectedDate)} · ${formatTime(currentTime || "")}`
                      : currentDate && currentTime
                      ? `${formatDate(currentDate)} · ${formatTime(currentTime)}`
                      : "Not selected"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Calendar Section */}
      <div className="-mt-1 pb-3 border-b border-[#d6a249]/30">
        <SectionTitle
          icon={
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
        >
          Change Date
        </SectionTitle>

        <div className="w-full rounded-2xl border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.08)] overflow-hidden" style={{ backgroundColor: '#ffffff' }}>
          {/* Gold Accent Bar */}
          <div
            className="h-1 bg-gradient-to-r from-[#d6a249] to-[#f4b864]"
            style={{
              width: goldBarVisible ? "100%" : "0%",
              transition: "width 400ms ease-out",
            }}
          />
          <div className="px-5 py-6">
            <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-neutral-100 active:scale-95 transition-all duration-200"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M10 12L6 8L10 4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            <div className="text-base font-semibold text-neutral-900">
              {monthNames[currentMonth]} {currentYear}
            </div>

            <button
              type="button"
              onClick={handleNextMonth}
              className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-neutral-100 active:scale-95 transition-all duration-200"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M6 4L10 8L6 12"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div
                key={day}
                className="text-center text-xs font-semibold text-neutral-500 py-1.5"
              >
                {day}
              </div>
            ))}

            {calendarDays.map((date, index) => {
              if (!date) {
                return <div key={`empty-${index}`} className="h-9" />;
              }

              const isSelected =
                selectedDate &&
                date.toDateString() === selectedDate.toDateString();
              const isToday = date.toDateString() === today.toDateString();
              const isPast = date < today && !isToday;

              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  onClick={() => handleDateSelect(date)}
                  disabled={isPast}
                  className={`h-9 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isSelected
                      ? "bg-gradient-to-br from-[#d6a249] to-[#f4b864] text-white font-bold shadow-md ring-2 ring-[#d6a249] ring-offset-1"
                      : isPast
                      ? "text-neutral-300 cursor-not-allowed"
                      : isToday
                      ? "bg-[#fff7ec] text-[#7b4ea3] hover:bg-[#f5e6d3] font-semibold border border-[#d6a249]/30"
                      : "text-neutral-700 hover:bg-neutral-50"
                  }`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          </div>
        </div>
      </div>

      {/* Time Selection */}
      {selectedDate && (
        <div className="mt-3">
          <SectionTitle
            icon={
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="text-[#d6a249]"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M12 6v6l4 2"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            }
          >
            Change Time
          </SectionTitle>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 mt-3">
            {timeSlots.map((time) => {
              const isSelected = selectedTime === time;
              return (
                <button
                  key={time}
                  type="button"
                  onClick={() => handleTimeSelect(time)}
                  className={`rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200 ${
                    isSelected
                      ? "bg-gradient-to-br from-[#d6a249] to-[#f4b864] text-white shadow-md ring-2 ring-[#d6a249] ring-offset-1"
                      : "bg-white shadow-sm hover:bg-[#f5e6d3] hover:shadow-md hover:ring-2 hover:ring-[#d6a249]/50 hover:ring-offset-1 text-neutral-700 active:scale-[0.96] border border-neutral-100"
                  }`}
                >
                  {time}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="mt-6 space-y-3">
        <PrimaryButton
          onClick={handleConfirm}
          disabled={!selectedDate || !selectedTime}
          size="default"
          fullWidth={true}
        >
          Confirm
        </PrimaryButton>

        <SecondaryButton
          onClick={handleChangeService}
          size="default"
          fullWidth={true}
        >
          Change Service
        </SecondaryButton>

        <div className="text-center">
          <button
            type="button"
            onClick={handleCancel}
            className="text-sm text-neutral-600 underline hover:text-neutral-800 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Reassurance footer */}
      <div className="mt-6 pb-4">
        <p className="text-xs text-neutral-500 text-center leading-relaxed">
          No payment required to reserve · You can reschedule from your profile
        </p>
      </div>
    </PageLayout>
  );
}

