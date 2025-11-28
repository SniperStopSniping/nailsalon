"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const SERVICES: Record<string, { name: string; price: number; duration: number }> = {
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

// Generate available time slots (9 AM to 6 PM, every 30 minutes)
const generateTimeSlots = () => {
  const slots: string[] = [];
  for (let hour = 9; hour < 18; hour++) {
    slots.push(`${hour}:00`);
    slots.push(`${hour}:30`);
  }
  return slots;
};

// Generate calendar days for a given month
const generateCalendarDays = (year: number, month: number) => {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();
  
  const days: (Date | null)[] = [];
  
  // Add empty cells for days before the first day of the month
  for (let i = 0; i < startingDayOfWeek; i++) {
    days.push(null);
  }
  
  // Add all days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    days.push(new Date(year, month, day));
  }
  
  return days;
};

export default function BookTimePage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = (params?.locale as string) || "en";
  const serviceIds = searchParams.get("serviceIds")?.split(",") || [];
  const techId = searchParams.get("techId") || "";

  const selectedServices = serviceIds
    .map((id) => SERVICES[id])
    .filter(Boolean);
  const totalDuration = selectedServices.reduce((sum, service) => sum + service.duration, 0);
  const totalPrice = selectedServices.reduce((sum, service) => sum + service.price, 0);
  const techName = TECHNICIANS[techId] || "Not selected";
  const serviceNames = selectedServices.map(s => s.name).join(", ");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date | null>(today);

  const timeSlots = generateTimeSlots();
  const calendarDays = generateCalendarDays(currentYear, currentMonth);

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
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
    if (!selectedDate) return;
    
    const dateStr = selectedDate.toISOString().split("T")[0];
    router.push(
      `/${locale}/book/confirm?serviceIds=${serviceIds.join(",")}&techId=${techId}&date=${dateStr}&time=${time}`
    );
  };

  const handleBack = () => {
    router.back();
  };

  return (
    <div className="min-h-screen bg-[#f5e8d8] flex justify-center py-6">
      <div className="mx-auto max-w-[430px] w-full px-4 flex flex-col gap-3">
        {/* Top bar with back button */}
        <div className="pt-2 relative flex items-center mb-1">
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

          {/* Title - centered */}
          <div className="absolute left-1/2 transform -translate-x-1/2 text-xl font-semibold text-[#7b4ea3]">
            Select Time
          </div>
        </div>

        {/* Premium Booking Summary Card */}
        <div className="rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.08)] overflow-hidden">
          {/* Step indicator accent bar */}
          <div className="h-1 bg-gradient-to-r from-[#d6a249] to-[#f4b864]" />
          
          <div className="px-5 py-4">
            <div className="flex items-center justify-center text-sm text-neutral-900">
              <span className="font-bold">
                {serviceNames || "Not selected"}
              </span>
              {selectedServices.length > 0 && (
                <>
                  <span className="mx-2 text-neutral-400">·</span>
                  <span className="font-medium">${totalPrice}</span>
                </>
              )}
              <span className="mx-2 text-neutral-400">·</span>
              <span className="font-medium">{techName}</span>
              <span className="mx-2 text-neutral-400">·</span>
              <span className="font-medium">{totalDuration} min</span>
            </div>
          </div>
        </div>

        {/* Encouraging microcopy */}
        <p className="text-xs text-neutral-600 text-center px-2 -mt-1">
          You're almost done — pick a date and time that works best for you.
        </p>

        {/* Calendar Section */}
        <div className="mt-1">
          <div className="flex items-center gap-2 mb-3 px-1">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="text-[#d6a249]"
            >
              <path
                d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <h3 className="text-base font-semibold text-neutral-900">Choose Date</h3>
          </div>
          
          <div className="rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.08)] p-4">
            {/* Month/Year Navigation */}
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
              
              <div className="text-lg font-semibold text-neutral-900">
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

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1">
              {/* Day headers */}
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div
                  key={day}
                  className="text-center text-xs font-semibold text-neutral-500 py-1.5"
                >
                  {day}
                </div>
              ))}
              
              {/* Calendar days */}
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

        {/* Time Selection */}
        {selectedDate && (
          <div className="mt-3">
            <div className="flex items-center gap-2 mb-2 px-1">
              <h3 className="text-base font-semibold text-neutral-900">Select Time</h3>
            </div>
            <p className="text-[10px] text-neutral-500 mb-3 px-1">
              Times shown in local timezone
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
              {timeSlots.map((time) => {
                return (
                  <button
                    key={time}
                    type="button"
                    onClick={() => handleTimeSelect(time)}
                    className="rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200 bg-white shadow-sm hover:bg-[#f5e6d3] hover:shadow-md hover:ring-2 hover:ring-[#d6a249]/50 hover:ring-offset-1 text-neutral-700 active:scale-[0.96] border border-neutral-100"
                  >
                    {time}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Reassurance footer */}
        <div className="mt-6 pb-4">
          <p className="text-[10px] text-neutral-500 text-center leading-relaxed">
            No payment required to reserve · You can reschedule from your profile
          </p>
        </div>
      </div>
    </div>
  );
}

