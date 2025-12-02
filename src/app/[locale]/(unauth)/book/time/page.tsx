"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";

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

const TECHNICIANS: Record<string, { name: string; image: string }> = {
  daniela: { name: "Daniela", image: "/assets/images/tech-daniela.jpeg" },
  tiffany: { name: "Tiffany", image: "/assets/images/tech-tiffany.jpeg" },
  jenny: { name: "Jenny", image: "/assets/images/tech-jenny.jpeg" },
};

const generateTimeSlots = () => {
  const slots: { time: string; period: "morning" | "afternoon" | "evening" }[] = [];
  for (let hour = 9; hour < 18; hour++) {
    const period = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
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
  const totalDuration = selectedServices.reduce(
    (sum, service) => sum + service.duration,
    0
  );
  const totalPrice = selectedServices.reduce(
    (sum, service) => sum + service.price,
    0
  );
  const tech = TECHNICIANS[techId];
  const serviceNames = selectedServices.map((s) => s.name).join(" + ");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [mounted, setMounted] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date | null>(today); // Start with today selected

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
          className="pt-6 pb-4 relative flex items-center"
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

        {/* Progress Steps */}
        <div
          className="flex items-center justify-center gap-2 mb-6"
          style={{
            opacity: mounted ? 1 : 0,
            transition: "opacity 300ms ease-out 50ms",
          }}
        >
          {["Service", "Artist", "Time", "Confirm"].map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 ${i === 2 ? "opacity-100" : "opacity-40"}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  i < 2 ? "bg-[#7b4ea3] text-white" : i === 2 ? "bg-[#f4b864] text-neutral-900" : "bg-neutral-300 text-neutral-600"
                }`}>
                  {i < 2 ? "✓" : i + 1}
                </div>
                <span className={`text-xs font-medium ${i === 2 ? "text-neutral-900" : "text-neutral-500"}`}>
                  {step}
                </span>
              </div>
              {i < 3 && <div className="w-4 h-px bg-neutral-300" />}
            </div>
          ))}
        </div>

        {/* Booking Summary Card */}
        <div
          className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-[#7b4ea3] to-[#5c3a7d] shadow-xl"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0) scale(1)" : "translateY(10px) scale(0.97)",
            transition: "opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms",
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
                <div className="text-white font-bold text-base truncate">{serviceNames || "Service"}</div>
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
            transition: "opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms",
          }}
        >
          <h1 className="text-2xl font-bold text-neutral-900">
            Pick Your Time
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            {selectedDate 
              ? `${formatSelectedDate(selectedDate)} · Tap another date to change`
              : "Select a day that works for you"
            }
          </p>
        </div>

        {/* Calendar Card */}
        <div
          className="overflow-hidden rounded-2xl bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.06)] mb-4"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(10px)",
            transition: "opacity 300ms ease-out 200ms, transform 300ms ease-out 200ms",
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

        {/* Time Selection - Only shows when date is selected */}
        {selectedDate && (
          <div
            className="space-y-4"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? "translateY(0)" : "translateY(10px)",
              transition: "opacity 300ms ease-out 250ms, transform 300ms ease-out 250ms",
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
                {morningSlots.map((slot, i) => (
                  <button
                    key={slot.time}
                    type="button"
                    onClick={() => handleTimeSelect(slot.time)}
                    className="py-3 px-2 rounded-xl bg-gradient-to-br from-[#fff7ec] to-[#fef5e7] text-sm font-bold text-neutral-800 hover:from-[#f4b864] hover:to-[#d6a249] hover:text-neutral-900 hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 border border-[#f4b864]/20"
                    style={{
                      animationDelay: `${i * 30}ms`,
                    }}
                  >
                    {formatTime12h(slot.time)}
                  </button>
                ))}
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
                {afternoonSlots.map((slot, i) => (
                  <button
                    key={slot.time}
                    type="button"
                    onClick={() => handleTimeSelect(slot.time)}
                    className="py-3 px-2 rounded-xl bg-gradient-to-br from-[#fff7ec] to-[#fef5e7] text-sm font-bold text-neutral-800 hover:from-[#f4b864] hover:to-[#d6a249] hover:text-neutral-900 hover:shadow-md hover:scale-105 active:scale-95 transition-all duration-200 border border-[#f4b864]/20"
                    style={{
                      animationDelay: `${(i + morningSlots.length) * 30}ms`,
                    }}
                  >
                    {formatTime12h(slot.time)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Help text when no date selected */}
        {!selectedDate && (
          <div
            className="text-center py-8"
            style={{
              opacity: mounted ? 1 : 0,
              transition: "opacity 300ms ease-out 300ms",
            }}
          >
            <div className="text-4xl mb-3">📅</div>
            <p className="text-neutral-500 text-sm">
              Tap a date above to see available times
            </p>
          </div>
        )}

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
