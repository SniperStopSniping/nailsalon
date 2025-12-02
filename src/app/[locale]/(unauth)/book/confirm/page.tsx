"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { PageLayout } from "@/components/PageLayout";
import { MainCard } from "@/components/MainCard";
import { SummaryRow } from "@/components/SummaryRow";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SecondaryButton } from "@/components/SecondaryButton";
import { FormInput } from "@/components/FormInput";
import { RewardInfoRow } from "@/components/RewardInfoRow";

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

export default function BookConfirmPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = (params?.locale as string) || "en";
  const serviceIds = searchParams.get("serviceIds")?.split(",") || [];
  const techId = searchParams.get("techId") || "";
  const dateStr = searchParams.get("date") || "";
  const timeStr = searchParams.get("time") || "";

  const [checkmarkVisible, setCheckmarkVisible] = useState(false);
  const [titleVisible, setTitleVisible] = useState(false);
  const [cardVisible, setCardVisible] = useState(false);
  const [goldBarVisible, setGoldBarVisible] = useState(false);

  const [discountCode, setDiscountCode] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState<{
    code: string;
    amount: number;
    type: "percentage" | "points";
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [highlightRows, setHighlightRows] = useState(false);

  useEffect(() => {
    setCheckmarkVisible(true);
    setTimeout(() => setTitleVisible(true), 220);
    setTimeout(() => {
      setCardVisible(true);
      setTimeout(() => setGoldBarVisible(true), 50);
    }, 300);
  }, []);

  const selectedServices = serviceIds
    .map((id) => SERVICES[id])
    .filter(Boolean);
  const originalPrice = selectedServices.reduce(
    (sum, service) => sum + service.price,
    0
  );
  const totalDuration = selectedServices.reduce(
    (sum, service) => sum + service.duration,
    0
  );
  const techName = TECHNICIANS[techId] || "Not selected";
  const serviceNames = selectedServices.map((s) => s.name).join(", ");

  const discountAmount = appliedDiscount?.amount || 0;
  const finalPrice = Math.max(0, originalPrice - discountAmount);
  const pointsEarned = Math.round(originalPrice * 0.1);

  const formatDate = (dateString: string) => {
    if (!dateString) return "Not selected";
    const date = new Date(dateString);
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
    return `${daysOfWeek[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  };

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

  const handleViewProfile = () => {
    router.push(`/${locale}/profile`);
  };

  const handleApplyDiscount = () => {
    setErrorMessage("");
    const code = discountCode.trim().toUpperCase();

    if (!code) {
      setErrorMessage("Please enter a code");
      return;
    }

    let discount: {
      amount: number;
      type: "percentage" | "points";
      code: string;
    } | null = null;

    if (code === "WELCOME10") {
      discount = {
        amount: originalPrice * 0.1,
        type: "percentage",
        code: "WELCOME10",
      };
    } else if (code === "SAVE15") {
      discount = {
        amount: originalPrice * 0.15,
        type: "percentage",
        code: "SAVE15",
      };
    } else if (code === "FIRST20") {
      discount = {
        amount: originalPrice * 0.2,
        type: "percentage",
        code: "FIRST20",
      };
    } else if (/^\d+$/.test(code)) {
      const points = parseInt(code, 10);
      if (points > 0 && points <= 1000) {
        discount = {
          amount: Math.min(points * 0.1, originalPrice * 0.5),
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

    setAppliedDiscount(discount);
    setDiscountCode("");
    setHighlightRows(true);
    setTimeout(() => setHighlightRows(false), 2000);
  };

  return (
    <PageLayout>
      <div className="flex flex-col items-center gap-4">
        {/* Large Gold Checkmark Icon with Glow */}
        <div
          className="relative"
          style={{
            opacity: checkmarkVisible ? 1 : 0,
            transform: checkmarkVisible ? "scale(1)" : "scale(0.85)",
            transition: "opacity 200ms ease-out, transform 200ms ease-out",
          }}
        >
          <div
            className="absolute inset-0 rounded-full blur-2xl opacity-50"
            style={{ backgroundColor: "#d6a249" }}
          />
          <div className="relative w-20 h-20 rounded-full bg-[#d6a249] flex items-center justify-center shadow-[0_8px_24px_rgba(214,162,73,0.4)]">
            <svg
              width="40"
              height="40"
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

        {/* Headline */}
        <h1
          className="text-xl font-semibold text-[#7b4ea3] text-center"
          style={{
            opacity: titleVisible ? 1 : 0,
            transform: titleVisible ? "translateY(0)" : "translateY(10px)",
            transition: "opacity 250ms ease-out, transform 250ms ease-out",
          }}
        >
          Appointment Confirmed
        </h1>

        {/* Main Confirmation Card */}
        <div
          className="w-full max-w-sm rounded-2xl bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.08)] overflow-hidden"
          style={{
            opacity: cardVisible ? 1 : 0,
            transform: cardVisible
              ? "translateY(0) scale(1)"
              : "translateY(10px) scale(0.97)",
            transition: cardVisible
              ? "opacity 250ms ease-out, transform 250ms ease-out, box-shadow 300ms ease-out"
              : "opacity 250ms ease-out, transform 250ms ease-out",
          }}
          onMouseEnter={(e) => {
            if (window.innerWidth >= 768 && cardVisible) {
              e.currentTarget.style.transform = "translateY(-1px) scale(1)";
              e.currentTarget.style.boxShadow =
                "0_4px_20px_rgba(0, 0, 0, 0.1)";
            }
          }}
          onMouseLeave={(e) => {
            if (window.innerWidth >= 768 && cardVisible) {
              e.currentTarget.style.transform = "translateY(0) scale(1)";
              e.currentTarget.style.boxShadow =
                "0_4px_20px_rgba(0, 0, 0, 0.08)";
            }
          }}
        >
          {/* Gold Accent Bar */}
          <div
            className="h-1 bg-gradient-to-r from-[#d6a249] to-[#f4b864]"
            style={{
              width: goldBarVisible ? "100%" : "0%",
              transition: "width 400ms ease-out",
            }}
          />

          <div className="px-5 pt-4 pb-6 relative">
            {/* Profile Icon in Top Right */}
            <button
              type="button"
              onClick={handleViewProfile}
              className="absolute top-[9px] right-5 w-10 h-10 rounded-full bg-[#7b4ea3]/10 flex items-center justify-center hover:bg-[#7b4ea3]/20 transition-colors active:scale-95"
              aria-label="View Profile"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="text-[#7b4ea3]"
              >
                <path
                  d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
                  fill="currentColor"
                />
              </svg>
            </button>
            {/* Summary Section */}
            <div className="pb-4 border-b border-neutral-100 space-y-2 mt-[41px]">
              <SummaryRow label="Service" value={serviceNames || "Not selected"} />
              <SummaryRow label="Nail Tech" value={techName} />
              <SummaryRow
                label="Date & Time"
                value={`${formatDate(dateStr)} · ${formatTime(timeStr)}`}
              />
              <SummaryRow label="Duration" value={`${totalDuration} min`} />
              <SummaryRow
                label="Original Price"
                value={`$${originalPrice.toFixed(2)}`}
              />
              <SummaryRow
                label="Reward / Discount"
                highlight={highlightRows}
                value={
                  appliedDiscount ? (
                    <span className="text-[#d6a249]">
                      –${discountAmount.toFixed(2)} ({appliedDiscount.code})
                    </span>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )
                }
              />
              <div
                className={`flex justify-between items-start pt-2.5 border-t border-neutral-100 transition-all duration-500 ${
                  highlightRows ? "bg-[#fef9e7] rounded px-2 py-1.5 -mx-2 mt-2" : ""
                }`}
              >
                <div className="text-[18px] font-bold text-neutral-900">
                  New Total
                </div>
                <div className="text-[18px] font-bold text-neutral-900 text-right">
                  ${finalPrice.toFixed(2)}
                </div>
              </div>
            </div>

            {/* Discount Input Section */}
            <div className="py-4 border-b border-neutral-100">
              <p className="text-[13px] text-neutral-600 mb-3">
                Have rewards or a discount code?
              </p>
              <div className="flex gap-2 items-center">
                <FormInput
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
                />
                <PrimaryButton
                  onClick={handleApplyDiscount}
                  size="sm"
                  fullWidth={false}
                  className="whitespace-nowrap self-center"
                >
                  Apply
                </PrimaryButton>
              </div>
              {errorMessage && (
                <p className="text-xs text-red-500 mt-2 ml-1">{errorMessage}</p>
              )}
            </div>

            {/* Thank You & Points Section */}
            <RewardInfoRow points={pointsEarned} />

            {/* Payment Buttons Area */}
            <div className="pt-4 flex flex-col gap-3 items-center">
              {/* Apple Pay Button */}
              <button
                type="button"
                onClick={() => {
                  // Handle Apple Pay payment
                  console.log("Apple Pay clicked");
                }}
                className="w-full h-12 rounded-xl bg-black text-white font-semibold text-base flex items-center justify-center gap-2 hover:bg-neutral-800 active:scale-98 transition-all shadow-sm"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="text-white"
                >
                  <path
                    d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"
                    fill="currentColor"
                  />
                </svg>
                <span>Pay with Apple Pay</span>
              </button>

              {/* Regular Pay Button */}
              <PrimaryButton 
                onClick={() => {
                  // Handle regular payment
                  console.log("Pay clicked");
                }}
                size="sm"
                fullWidth={true}
              >
                Pay ${finalPrice.toFixed(2)}
              </PrimaryButton>

              {/* View Appointment Button */}
              <SecondaryButton 
                onClick={handleViewAppointment}
                size="sm"
                fullWidth={true}
              >
                View Appointment
              </SecondaryButton>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
