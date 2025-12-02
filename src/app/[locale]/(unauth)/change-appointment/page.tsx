"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";

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

const TECHNICIANS: Record<string, { name: string; image: string }> = {
  daniela: { name: "Daniela", image: "/assets/images/tech-daniela.jpeg" },
  tiffany: { name: "Tiffany", image: "/assets/images/tech-tiffany.jpeg" },
  jenny: { name: "Jenny", image: "/assets/images/tech-jenny.jpeg" },
};

const generateTimeSlots = () => {
  const slots: { time: string; period: "morning" | "afternoon" }[] = [];
  for (let hour = 9; hour < 18; hour++) {
    const period = hour < 12 ? "morning" : "afternoon";
    slots.push({ time: `${hour}:00`, period });
    slots.push({ time: `${hour}:30`, period });
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

const formatTime12h = (time: string) => {
  const [hour, minute] = time.split(":");
  const h = parseInt(hour || "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${minute} ${ampm}`;
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
  const tech = TECHNICIANS[techId];
  const serviceNames =
    selectedServices.length > 0
      ? selectedServices.map((s) => s.name).join(" + ")
      : "Not selected";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Initialize selected date from URL or default to today
  const initialDate = currentDate ? new Date(currentDate) : today;
  initialDate.setHours(0, 0, 0, 0);

  const [mounted, setMounted] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(initialDate.getMonth());
  const [currentYear, setCurrentYear] = useState(initialDate.getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date | null>(initialDate);
  const [selectedTime, setSelectedTime] = useState<string>(currentTime);

  useEffect(() => {
    setMounted(true);
  }, []);

  const timeSlots = generateTimeSlots();
  const calendarDays = generateCalendarDays(currentYear, currentMonth);

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const dayNames = ["S", "M", "T", "W", "T", "F", "S"];

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
    const todayCheck = new Date();
    todayCheck.setHours(0, 0, 0, 0);
    if (date >= todayCheck) {
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

  const handleBack = () => {
    router.back();
  };

  const formatSelectedDate = (date: Date) => {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  };

  // Group times by period
  const morningSlots = timeSlots.filter(s => s.period === "morning");
  const afternoonSlots = timeSlots.filter(s => s.period === "afternoon");

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f8f0e5] via-[#f6ebdd] to-[#f4e6d4]">
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4 pb-10">
        {/* Header */}
        <div
          className="pt-5 pb-2 relative flex items-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(-8px)",
            transition: "opacity 300ms ease-out, transform 300ms ease-out",
          }}
        >
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center justify-center w-11 h-11 rounded-full hover:bg-white/60 active:scale-95 transition-all duration-200 z-10"
          >
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div className="absolute left-1/2 transform -translate-x-1/2 text-lg font-semibold tracking-tight text-[#7b4ea3]">
            Nail Salon No.5
          </div>
        </div>

        {/* Appointment Summary Card */}
        <div
          className="mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-[#7b4ea3] to-[#5c3a7d] shadow-xl"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0) scale(1)" : "translateY(10px) scale(0.97)",
            transition: "opacity 300ms ease-out 50ms, transform 300ms ease-out 50ms",
          }}
        >
          <div className="px-5 py-4">
            <div className="flex items-center gap-4">
              {tech && (
                <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-white/30 flex-shrink-0">
                  <img src={tech.image} alt={tech.name} className="w-full h-full object-cover" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-white/70 text-xs mb-0.5">Your appointment</div>
                <div className="text-white font-bold text-base truncate">{serviceNames}</div>
                <div className="text-[#f4b864] text-sm font-medium">
                  with {tech?.name || "Artist"} · {totalDuration} min
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-white">${totalPrice}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Title */}
        <div
          className="text-center mb-4"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(10px)",
            transition: "opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms",
          }}
        >
          <h1 className="text-2xl font-bold text-neutral-900">
            Change Your Appointment
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            {selectedDate && selectedTime
              ? `${formatSelectedDate(selectedDate)} at ${formatTime12h(selectedTime)}`
              : selectedDate
              ? `${formatSelectedDate(selectedDate)} · Select a time`
              : "Select a new date and time"
            }
          </p>
        </div>

        {/* Calendar Card */}
        <div
          className="overflow-hidden rounded-2xl bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.06)] mb-4"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(10px)",
            transition: "opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms",
          }}
        >
          {/* Month Navigation */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-neutral-100 active:scale-95 transition-all"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <div className="text-lg font-bold text-neutral-900">
              {monthNames[currentMonth]} {currentYear}
            </div>

            <button
              type="button"
              onClick={handleNextMonth}
              className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-neutral-100 active:scale-95 transition-all"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Day Names */}
          <div className="grid grid-cols-7 px-4 pt-3">
            {dayNames.map((day, i) => (
              <div key={i} className="text-center text-xs font-bold text-neutral-400 py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1 px-4 pb-4">
            {calendarDays.map((date, index) => {
              if (!date) {
                return <div key={`empty-${index}`} className="h-11" />;
              }

              const isSelected = selectedDate && date.toDateString() === selectedDate.toDateString();
              const isToday = date.toDateString() === today.toDateString();
              const isPast = date < today && !isToday;

              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  onClick={() => handleDateSelect(date)}
                  disabled={isPast}
                  className={`h-11 rounded-xl text-sm font-semibold transition-all duration-200 ${
                    isSelected
                      ? "bg-gradient-to-br from-[#f4b864] to-[#d6a249] text-neutral-900 shadow-lg scale-110 z-10"
                      : isPast
                      ? "text-neutral-300 cursor-not-allowed"
                      : isToday
                      ? "bg-[#7b4ea3] text-white"
                      : "text-neutral-700 hover:bg-[#f6ebdd]"
                  }`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </div>

        {/* Time Selection */}
        {selectedDate && (
          <div
            className="space-y-4"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? "translateY(0)" : "translateY(10px)",
              transition: "opacity 300ms ease-out 200ms, transform 300ms ease-out 200ms",
            }}
          >
            {/* Morning Times */}
            <div className="overflow-hidden rounded-2xl bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
              <div className="px-5 py-3 border-b border-neutral-100 flex items-center gap-2">
                <span className="text-xl">🌅</span>
                <span className="text-sm font-bold text-neutral-900">Morning</span>
                <span className="text-xs text-neutral-400">9:00 AM - 12:00 PM</span>
              </div>
              <div className="p-4 grid grid-cols-3 gap-2">
                {morningSlots.map((slot) => {
                  const isSelected = selectedTime === slot.time;
                  return (
                    <button
                      key={slot.time}
                      type="button"
                      onClick={() => handleTimeSelect(slot.time)}
                      className={`py-3 px-2 rounded-xl text-sm font-bold transition-all duration-200 border ${
                        isSelected
                          ? "bg-gradient-to-br from-[#f4b864] to-[#d6a249] text-neutral-900 shadow-lg border-[#d6a249] scale-105"
                          : "bg-gradient-to-br from-[#fff7ec] to-[#fef5e7] text-neutral-800 border-[#f4b864]/20 hover:from-[#f4b864] hover:to-[#d6a249] hover:text-neutral-900 hover:shadow-md hover:scale-105 active:scale-95"
                      }`}
                    >
                      {formatTime12h(slot.time)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Afternoon Times */}
            <div className="overflow-hidden rounded-2xl bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
              <div className="px-5 py-3 border-b border-neutral-100 flex items-center gap-2">
                <span className="text-xl">☀️</span>
                <span className="text-sm font-bold text-neutral-900">Afternoon</span>
                <span className="text-xs text-neutral-400">12:00 PM - 6:00 PM</span>
              </div>
              <div className="p-4 grid grid-cols-3 gap-2">
                {afternoonSlots.map((slot) => {
                  const isSelected = selectedTime === slot.time;
                  return (
                    <button
                      key={slot.time}
                      type="button"
                      onClick={() => handleTimeSelect(slot.time)}
                      className={`py-3 px-2 rounded-xl text-sm font-bold transition-all duration-200 border ${
                        isSelected
                          ? "bg-gradient-to-br from-[#f4b864] to-[#d6a249] text-neutral-900 shadow-lg border-[#d6a249] scale-105"
                          : "bg-gradient-to-br from-[#fff7ec] to-[#fef5e7] text-neutral-800 border-[#f4b864]/20 hover:from-[#f4b864] hover:to-[#d6a249] hover:text-neutral-900 hover:shadow-md hover:scale-105 active:scale-95"
                      }`}
                    >
                      {formatTime12h(slot.time)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div
          className="mt-6 space-y-3"
          style={{
            opacity: mounted ? 1 : 0,
            transition: "opacity 300ms ease-out 300ms",
          }}
        >
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedDate || !selectedTime}
            className={`w-full py-4 rounded-xl font-bold text-base transition-all duration-200 ${
              selectedDate && selectedTime
                ? "bg-gradient-to-r from-[#f4b864] to-[#d6a249] text-neutral-900 shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]"
                : "bg-neutral-200 text-neutral-400 cursor-not-allowed"
            }`}
          >
            {selectedDate && selectedTime ? "Confirm Changes" : "Select date & time"}
          </button>

          <button
            type="button"
            onClick={handleChangeService}
            className="w-full py-3 rounded-xl font-semibold text-base border-2 border-[#7b4ea3] text-[#7b4ea3] hover:bg-[#7b4ea3]/5 active:scale-[0.98] transition-all duration-200"
          >
            Change Service or Tech
          </button>
        </div>

        {/* Footer */}
        <div
          className="mt-6 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transition: "opacity 300ms ease-out 400ms",
          }}
        >
          <p className="text-xs text-neutral-400">
            ✨ No payment required to reserve
          </p>
          <p className="text-xs text-neutral-400 mt-0.5">
            Free cancellation up to 24 hours before
          </p>
        </div>
      </div>
    </div>
  );
}
