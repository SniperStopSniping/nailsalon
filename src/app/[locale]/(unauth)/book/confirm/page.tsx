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

const TECHNICIANS: Record<string, string> = {
  daniela: "Daniela",
  tiffany: "Tiffany",
  jenny: "Jenny",
};

export default function BookConfirmPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = (params?.locale as string) || "en";
  const serviceIds = searchParams.get("serviceIds")?.split(",") || [];
  const techId = searchParams.get("techId") || "";
  const dateStr = searchParams.get("date") || "";
  const timeStr = searchParams.get("time") || "";

  // Animation states
  const [checkmarkVisible, setCheckmarkVisible] = useState(false);
  const [titleVisible, setTitleVisible] = useState(false);
  const [cardVisible, setCardVisible] = useState(false);
  const [goldBarVisible, setGoldBarVisible] = useState(false);

  // Price and discount states
  const [discountCode, setDiscountCode] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState<{
    code: string;
    amount: number;
    type: "percentage" | "points";
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [highlightRows, setHighlightRows] = useState(false);

  // Trigger animations on mount
  useEffect(() => {
    // Checkmark appears first (180-220ms animation)
    setCheckmarkVisible(true);
    
    // Then title (after checkmark starts, ~220ms delay)
    setTimeout(() => setTitleVisible(true), 220);
    
    // Then main card (after title, ~50-80ms delay)
    setTimeout(() => {
      setCardVisible(true);
      // Gold bar animates slightly after card starts appearing
      setTimeout(() => setGoldBarVisible(true), 50);
    }, 300);
  }, []);

  const selectedServices = serviceIds
    .map((id) => SERVICES[id])
    .filter(Boolean);
  const originalPrice = selectedServices.reduce((sum, service) => sum + service.price, 0);
  const totalDuration = selectedServices.reduce((sum, service) => sum + service.duration, 0);
  const techName = TECHNICIANS[techId] || "Not selected";
  const serviceNames = selectedServices.map((s) => s.name).join(", ");

  // Calculate discount and final price
  const discountAmount = appliedDiscount?.amount || 0;
  const finalPrice = Math.max(0, originalPrice - discountAmount);
  const pointsEarned = Math.round(originalPrice * 0.1); // 10% of original price as points

  // Format date for display
  const formatDate = (dateString: string) => {
    if (!dateString) return "Not selected";
    const date = new Date(dateString);
    const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${daysOfWeek[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  };

  // Format time for display (e.g., "2:00 PM")
  const formatTime = (timeString: string) => {
    if (!timeString) return "Not selected";
    const [hours, minutes] = timeString.split(":");
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const handleViewAppointment = () => {
    router.push(`/${locale}/appointments`);
  };

  const handleChangeAppointment = () => {
    router.push(`/${locale}/book/service`);
  };

  const handleViewProfile = () => {
    router.push(`/${locale}/profile`);
  };

  // Validate and apply discount code
  const handleApplyDiscount = () => {
    setErrorMessage("");
    const code = discountCode.trim().toUpperCase();

    if (!code) {
      setErrorMessage("Please enter a code");
      return;
    }

    // Hard-coded validation for demo
    let discount: { amount: number; type: "percentage" | "points"; code: string } | null = null;

    if (code === "WELCOME10") {
      // 10% off
      discount = {
        amount: originalPrice * 0.1,
        type: "percentage",
        code: "WELCOME10",
      };
    } else if (code === "SAVE15") {
      // 15% off
      discount = {
        amount: originalPrice * 0.15,
        type: "percentage",
        code: "SAVE15",
      };
    } else if (code === "FIRST20") {
      // 20% off
      discount = {
        amount: originalPrice * 0.2,
        type: "percentage",
        code: "FIRST20",
      };
    } else if (/^\d+$/.test(code)) {
      // Numeric codes treated as points (1 point = $0.10)
      const points = parseInt(code, 10);
      if (points > 0 && points <= 1000) {
        discount = {
          amount: Math.min(points * 0.1, originalPrice * 0.5), // Max 50% off
          type: "points",
          code: `${points} pts`,
        };
      } else {
        setErrorMessage("Invalid points amount");
        return;
      }
    } else {
      setErrorMessage("Invalid code");
      return;
    }

    // Apply discount
    setAppliedDiscount(discount);
    setDiscountCode("");

    // Highlight the discount and total rows
    setHighlightRows(true);
    setTimeout(() => setHighlightRows(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#f6ebdd] flex items-center justify-center py-8 px-4 overflow-y-auto">
      <div className="mx-auto max-w-[430px] w-full flex flex-col items-center gap-8 my-auto">
        {/* Large Gold Checkmark Icon with Glow - Success Animation */}
        <div 
          className="relative mt-4"
          style={{
            opacity: checkmarkVisible ? 1 : 0,
            transform: checkmarkVisible ? 'scale(1)' : 'scale(0.85)',
            transition: 'opacity 200ms ease-out, transform 200ms ease-out',
          }}
        >
          <div
            className="absolute inset-0 rounded-full blur-2xl opacity-50"
            style={{ backgroundColor: "#d6a249" }}
          />
          <div className="relative w-28 h-28 rounded-full bg-[#d6a249] flex items-center justify-center shadow-[0_12px_40px_rgba(214,162,73,0.5)]">
            <svg
              width="56"
              height="56"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="text-white"
            >
              <path
                d="M20 6L9 17l-5-5"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        {/* Headline - Staggered Reveal */}
        <h1 
          className="text-3xl font-semibold text-[#7b4ea3] text-center px-4"
          style={{
            opacity: titleVisible ? 1 : 0,
            transform: titleVisible ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 250ms ease-out, transform 250ms ease-out',
          }}
        >
          Appointment Confirmed
        </h1>

        {/* Main Confirmation Card - Single Cohesive Card */}
        <div 
          className="w-full rounded-2xl bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.08)] overflow-hidden"
          style={{
            opacity: cardVisible ? 1 : 0,
            transform: cardVisible ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
            transition: cardVisible 
              ? 'opacity 250ms ease-out, transform 250ms ease-out, box-shadow 300ms ease-out' 
              : 'opacity 250ms ease-out, transform 250ms ease-out',
          }}
          onMouseEnter={(e) => {
            if (window.innerWidth >= 768 && cardVisible) {
              e.currentTarget.style.transform = 'translateY(-1px) scale(1)';
              e.currentTarget.style.boxShadow = '0_4px_20px_rgba(0, 0, 0, 0.1)';
            }
          }}
          onMouseLeave={(e) => {
            if (window.innerWidth >= 768 && cardVisible) {
              e.currentTarget.style.transform = 'translateY(0) scale(1)';
              e.currentTarget.style.boxShadow = '0_4px_20px_rgba(0, 0, 0, 0.08)';
            }
          }}
        >
          {/* Gold Accent Bar - Left-to-Right Wipe Animation */}
          <div 
            className="h-1 bg-gradient-to-r from-[#d6a249] to-[#f4b864]"
            style={{
              width: goldBarVisible ? '100%' : '0%',
              transition: 'width 400ms ease-out',
            }}
          />
          
          <div className="px-5 py-6">
            {/* Summary Section - 2-Column Receipt Layout */}
            <div className="pb-5 border-b border-neutral-100 space-y-2.5">
              {/* Service */}
              <div className="flex justify-between items-start">
                <div className="text-[13px] text-neutral-500 font-medium">Service</div>
                <div className="text-[15px] font-semibold text-neutral-900 text-right">
                  {serviceNames || "Not selected"}
                </div>
              </div>

              {/* Nail Tech */}
              <div className="flex justify-between items-start">
                <div className="text-[13px] text-neutral-500 font-medium">Nail Tech</div>
                <div className="text-[15px] font-semibold text-neutral-900 text-right">
                  {techName}
                </div>
              </div>

              {/* Date & Time */}
              <div className="flex justify-between items-start">
                <div className="text-[13px] text-neutral-500 font-medium">Date & Time</div>
                <div className="text-[15px] font-semibold text-neutral-900 text-right">
                  {formatDate(dateStr)} · {formatTime(timeStr)}
                </div>
              </div>

              {/* Duration */}
              <div className="flex justify-between items-start">
                <div className="text-[13px] text-neutral-500 font-medium">Duration</div>
                <div className="text-[15px] font-semibold text-neutral-900 text-right">
                  {totalDuration} min
                </div>
              </div>

              {/* Original Price */}
              <div className="flex justify-between items-start">
                <div className="text-[13px] text-neutral-500 font-medium">Original Price</div>
                <div className="text-[15px] font-semibold text-neutral-900 text-right">
                  ${originalPrice.toFixed(2)}
                </div>
              </div>

              {/* Reward / Discount */}
              <div 
                className={`flex justify-between items-start transition-all duration-500 ${
                  highlightRows ? 'bg-[#fef9e7] rounded px-2 py-1.5 -mx-2' : ''
                }`}
              >
                <div className="text-[13px] text-neutral-500 font-medium">Reward / Discount</div>
                <div className="text-[15px] font-semibold text-right">
                  {appliedDiscount ? (
                    <span className="text-[#d6a249]">
                      –${discountAmount.toFixed(2)} ({appliedDiscount.code})
                    </span>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </div>
              </div>

              {/* New Total */}
              <div 
                className={`flex justify-between items-start pt-2.5 border-t border-neutral-100 transition-all duration-500 ${
                  highlightRows ? 'bg-[#fef9e7] rounded px-2 py-1.5 -mx-2 mt-2' : ''
                }`}
              >
                <div className="text-[15px] font-bold text-neutral-900">New Total</div>
                <div className="text-[17px] font-bold text-neutral-900 text-right">
                  ${finalPrice.toFixed(2)}
                </div>
              </div>
            </div>

            {/* Discount Input Section */}
            <div className="py-4 border-b border-neutral-100">
              <p className="text-[13px] text-neutral-600 mb-3">Have rewards or a discount code?</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={discountCode}
                  onChange={(e) => {
                    setDiscountCode(e.target.value);
                    setErrorMessage("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleApplyDiscount();
                    }
                  }}
                  placeholder="Reward or discount code"
                  className="flex-1 rounded-full bg-neutral-50 border border-neutral-200 px-4 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-[#d6a249] focus:ring-1 focus:ring-[#d6a249] transition-all"
                />
                <button
                  type="button"
                  onClick={handleApplyDiscount}
                  className="rounded-full bg-[#f4b864] px-5 py-2.5 text-sm font-semibold text-neutral-900 shadow-sm transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-md active:scale-[0.97] whitespace-nowrap"
                >
                  Apply
                </button>
              </div>
              {errorMessage && (
                <p className="text-xs text-red-500 mt-2 ml-1">{errorMessage}</p>
              )}
            </div>

            {/* Thank You & Points Section */}
            <div className="py-4">
              <p className="text-sm font-bold text-neutral-900">
                Thank you! We'll see you soon 💜
              </p>
              <p className="text-[13px] text-neutral-600 mt-1.5">
                You earned {pointsEarned} points from this visit.
              </p>
            </div>

            {/* Buttons Area - Bottom of Card */}
            <div className="pt-2 flex flex-col gap-3">
              {/* Primary Button */}
              <button
                type="button"
                onClick={handleViewAppointment}
                className="w-full rounded-full bg-[#f4b864] px-5 py-3.5 text-base font-bold text-neutral-900 shadow-sm transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-md active:scale-[0.97]"
              >
                View / Change Appointment
              </button>

              {/* Secondary Button */}
              <button
                type="button"
                onClick={handleViewProfile}
                className="w-full rounded-full bg-neutral-50 px-5 py-3.5 text-base font-semibold text-neutral-700 transition-all duration-200 ease-out hover:scale-[1.01] hover:bg-neutral-100 hover:shadow-sm active:scale-[0.98]"
              >
                View Profile
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

