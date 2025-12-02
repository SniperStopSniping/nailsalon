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

// Confetti particle component
const Confetti = ({ delay, color, left }: { delay: number; color: string; left: number }) => (
  <div
    className="absolute w-3 h-3 rounded-sm"
    style={{
      left: `${left}%`,
      top: "-10px",
      backgroundColor: color,
      animation: `confetti-fall 2.5s ease-out ${delay}s forwards`,
      transform: `rotate(${Math.random() * 360}deg)`,
    }}
  />
);

// Sparkle component
const Sparkle = ({ delay, size, left, top }: { delay: number; size: number; left: number; top: number }) => (
  <div
    className="absolute"
    style={{
      left: `${left}%`,
      top: `${top}%`,
      animation: `sparkle 1s ease-out ${delay}s forwards`,
      opacity: 0,
    }}
  >
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z"
        fill="#f4b864"
      />
    </svg>
  </div>
);

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
  const [stage, setStage] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showSparkles, setShowSparkles] = useState(false);
  const [pulseCheck, setPulseCheck] = useState(false);
  const [bounceEmoji, setBounceEmoji] = useState(false);

  useEffect(() => {
    // Duolingo-style staggered animations
    const timers = [
      setTimeout(() => setStage(1), 100),      // Show checkmark
      setTimeout(() => setPulseCheck(true), 300), // Pulse checkmark
      setTimeout(() => setShowConfetti(true), 400), // Confetti burst
      setTimeout(() => setShowSparkles(true), 500), // Sparkles
      setTimeout(() => setStage(2), 600),      // Show title
      setTimeout(() => setBounceEmoji(true), 800), // Bounce emoji
      setTimeout(() => setStage(3), 900),      // Show card
      setTimeout(() => setStage(4), 1100),     // Show details
      setTimeout(() => setStage(5), 1400),     // Show buttons
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const selectedServices = serviceIds.map((id) => SERVICES[id]).filter(Boolean);
  const originalPrice = selectedServices.reduce((sum, service) => sum + service.price, 0);
  const totalDuration = selectedServices.reduce((sum, service) => sum + service.duration, 0);
  const tech = TECHNICIANS[techId];
  const serviceNames = selectedServices.map((s) => s.name).join(" + ");
  const pointsEarned = Math.round(originalPrice * 0.1);

  const formatDate = (dateString: string) => {
    if (!dateString) return "Not selected";
    const date = new Date(dateString + "T00:00:00");
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  };

  const formatTime = (timeString: string) => {
    if (!timeString) return "";
    const [hours, minutes] = timeString.split(":");
    const hour = parseInt(hours || "0", 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const handleViewAppointment = () => {
    router.push(`/${locale}/change-appointment?serviceIds=${serviceIds.join(",")}&techId=${techId}&date=${dateStr}&time=${timeStr}`);
  };

  const confettiColors = ["#f4b864", "#7b4ea3", "#e9d5f5", "#d6a249", "#fef5e7", "#5c3a7d"];

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f8f0e5] via-[#f6ebdd] to-[#f4e6d4] overflow-hidden">
      {/* CSS Animations */}
      <style jsx>{`
        @keyframes confetti-fall {
          0% {
            transform: translateY(0) rotate(0deg) scale(1);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(720deg) scale(0.5);
            opacity: 0;
          }
        }
        @keyframes sparkle {
          0% {
            transform: scale(0) rotate(0deg);
            opacity: 0;
          }
          50% {
            transform: scale(1.2) rotate(180deg);
            opacity: 1;
          }
          100% {
            transform: scale(0) rotate(360deg);
            opacity: 0;
          }
        }
        @keyframes bounce-in {
          0% {
            transform: scale(0);
            opacity: 0;
          }
          50% {
            transform: scale(1.2);
          }
          70% {
            transform: scale(0.9);
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes pulse-glow {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(244, 184, 100, 0.7);
          }
          50% {
            box-shadow: 0 0 0 20px rgba(244, 184, 100, 0);
          }
        }
        @keyframes float {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-10px);
          }
        }
        @keyframes slide-up {
          from {
            transform: translateY(30px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        @keyframes emoji-bounce {
          0%, 100% {
            transform: scale(1);
          }
          25% {
            transform: scale(1.3) rotate(-10deg);
          }
          50% {
            transform: scale(1.1) rotate(10deg);
          }
          75% {
            transform: scale(1.2) rotate(-5deg);
          }
        }
      `}</style>

      {/* Confetti Layer */}
      {showConfetti && (
        <div className="fixed inset-0 pointer-events-none z-50">
          {Array.from({ length: 50 }).map((_, i) => (
            <Confetti
              key={i}
              delay={Math.random() * 0.5}
              color={confettiColors[i % confettiColors.length] || "#f4b864"}
              left={Math.random() * 100}
            />
          ))}
        </div>
      )}

      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4 pb-10 relative">
        {/* Sparkles Layer */}
        {showSparkles && (
          <div className="absolute inset-0 pointer-events-none">
            <Sparkle delay={0} size={24} left={15} top={10} />
            <Sparkle delay={0.2} size={18} left={80} top={15} />
            <Sparkle delay={0.4} size={20} left={25} top={25} />
            <Sparkle delay={0.3} size={16} left={70} top={8} />
            <Sparkle delay={0.5} size={22} left={90} top={20} />
          </div>
        )}

        {/* Success Icon */}
        <div className="flex flex-col items-center pt-8 pb-4">
          <div
            className="relative"
            style={{
              animation: stage >= 1 ? "bounce-in 0.5s ease-out forwards" : "none",
              opacity: stage >= 1 ? 1 : 0,
            }}
          >
            {/* Glow ring */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                animation: pulseCheck ? "pulse-glow 1s ease-out" : "none",
              }}
            />
            {/* Main checkmark circle */}
            <div className="w-28 h-28 rounded-full bg-gradient-to-br from-[#f4b864] to-[#d6a249] flex items-center justify-center shadow-2xl">
              <svg
                width="56"
                height="56"
                viewBox="0 0 24 24"
                fill="none"
                className="text-white"
                style={{
                  strokeDasharray: 30,
                  strokeDashoffset: stage >= 1 ? 0 : 30,
                  transition: "stroke-dashoffset 0.5s ease-out 0.3s",
                }}
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

          {/* Title */}
          <h1
            className="text-3xl font-bold text-[#7b4ea3] mt-6 text-center"
            style={{
              animation: stage >= 2 ? "slide-up 0.4s ease-out forwards" : "none",
              opacity: stage >= 2 ? 1 : 0,
            }}
          >
            You're All Set! 
            <span
              className="inline-block ml-2"
              style={{
                animation: bounceEmoji ? "emoji-bounce 0.6s ease-out" : "none",
              }}
            >
              💅
            </span>
          </h1>
          <p
            className="text-neutral-500 mt-2 text-center"
            style={{
              animation: stage >= 2 ? "slide-up 0.4s ease-out 0.1s forwards" : "none",
              opacity: stage >= 2 ? 1 : 0,
            }}
          >
            Your appointment is confirmed
          </p>
        </div>

        {/* Appointment Card */}
        <div
          className="overflow-hidden rounded-3xl bg-white border border-[#e6d6c2] shadow-xl mb-6"
          style={{
            animation: stage >= 3 ? "slide-up 0.5s ease-out forwards" : "none",
            opacity: stage >= 3 ? 1 : 0,
          }}
        >
          {/* Purple Header */}
          <div className="bg-gradient-to-r from-[#7b4ea3] to-[#5c3a7d] px-6 py-5">
            <div className="flex items-center gap-4">
              {tech && (
                <div 
                  className="w-16 h-16 rounded-full overflow-hidden border-3 border-white/30 flex-shrink-0"
                  style={{ animation: stage >= 4 ? "float 3s ease-in-out infinite" : "none" }}
                >
                  <img src={tech.image} alt={tech.name} className="w-full h-full object-cover" />
                </div>
              )}
              <div className="flex-1">
                <div className="text-white/70 text-sm">Your nail artist</div>
                <div className="text-white font-bold text-xl">{tech?.name || "Artist"}</div>
              </div>
              <div className="text-right">
                <div className="text-white/70 text-sm">Total</div>
                <div className="text-3xl font-bold text-[#f4b864]">${originalPrice}</div>
              </div>
            </div>
          </div>

          {/* Details */}
          <div
            className="px-6 py-5 space-y-4"
            style={{
              animation: stage >= 4 ? "slide-up 0.4s ease-out forwards" : "none",
              opacity: stage >= 4 ? 1 : 0,
            }}
          >
            {/* Service */}
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#f6ebdd] flex items-center justify-center text-2xl">
                💅
              </div>
              <div className="flex-1">
                <div className="text-xs text-neutral-400 uppercase tracking-wide">Service</div>
                <div className="text-lg font-bold text-neutral-900">{serviceNames || "Service"}</div>
              </div>
              <div className="text-sm text-neutral-500">{totalDuration} min</div>
            </div>

            {/* Date & Time */}
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#e9d5f5] flex items-center justify-center text-2xl">
                📅
              </div>
              <div className="flex-1">
                <div className="text-xs text-neutral-400 uppercase tracking-wide">When</div>
                <div className="text-lg font-bold text-neutral-900">{formatDate(dateStr)}</div>
                <div className="text-sm text-[#7b4ea3] font-medium">{formatTime(timeStr)}</div>
              </div>
            </div>

            {/* Points Earned - Clickable */}
            <button
              type="button"
              onClick={() => router.push(`/${locale}/rewards`)}
              className="w-full flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-r from-[#fef9e7] to-[#fef5e7] border border-[#f4b864]/30 hover:border-[#f4b864] hover:shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer text-left"
            >
              <div 
                className="w-12 h-12 rounded-xl bg-[#f4b864] flex items-center justify-center text-2xl flex-shrink-0"
                style={{ animation: stage >= 4 ? "float 2s ease-in-out infinite 0.5s" : "none" }}
              >
                ⭐
              </div>
              <div className="flex-1">
                <div className="text-sm text-neutral-600">You'll earn</div>
                <div className="text-xl font-bold text-[#7b4ea3]">+{pointsEarned} points</div>
              </div>
              <div className="flex items-center gap-1 text-xs text-[#7b4ea3] font-medium">
                <span>View Rewards</span>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div
          className="space-y-3"
          style={{
            animation: stage >= 5 ? "slide-up 0.4s ease-out forwards" : "none",
            opacity: stage >= 5 ? 1 : 0,
          }}
        >
          {/* Pay Now - Primary CTA */}
          <button
            type="button"
            onClick={() => console.log("Pay now clicked")}
            className="w-full flex items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-[#f4b864] to-[#d6a249] px-6 py-4 text-lg font-bold text-neutral-900 shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            <span className="text-xl">💳</span>
            Pay Now · ${originalPrice}
          </button>

          {/* Pay Later option */}
          <div className="text-center text-sm text-neutral-500 py-1">
            or pay at the salon
          </div>

          {/* View / Change */}
          <button
            type="button"
            onClick={handleViewAppointment}
            className="w-full flex items-center justify-center gap-3 rounded-2xl bg-white border-2 border-[#7b4ea3] px-6 py-4 text-lg font-bold text-[#7b4ea3] hover:bg-[#7b4ea3] hover:text-white active:scale-[0.98] transition-all"
          >
            View or Change Appointment
          </button>

          {/* Back to Home */}
          <button
            type="button"
            onClick={() => router.push(`/${locale}/profile`)}
            className="w-full text-center py-3 text-base font-medium text-neutral-500 hover:text-[#7b4ea3] transition-colors"
          >
            Back to Profile →
          </button>
        </div>

        {/* Fun Footer */}
        <div
          className="mt-8 text-center"
          style={{
            animation: stage >= 5 ? "slide-up 0.4s ease-out 0.2s forwards" : "none",
            opacity: stage >= 5 ? 1 : 0,
          }}
        >
          <div className="text-4xl mb-2">
            <span style={{ animation: "float 2s ease-in-out infinite" }} className="inline-block">✨</span>
            <span style={{ animation: "float 2s ease-in-out infinite 0.3s" }} className="inline-block mx-1">💜</span>
            <span style={{ animation: "float 2s ease-in-out infinite 0.6s" }} className="inline-block">✨</span>
          </div>
          <p className="text-sm text-neutral-400">
            We can't wait to see you!
          </p>
          <p className="text-xs text-neutral-400 mt-1">
            📱 We'll send you a text reminder
          </p>
          <p className="text-xs text-neutral-400 mt-0.5">
            Free cancellation up to 24 hours before
          </p>
        </div>

        {/* Bottom spacing */}
        <div className="h-6" />
      </div>
    </div>
  );
}
