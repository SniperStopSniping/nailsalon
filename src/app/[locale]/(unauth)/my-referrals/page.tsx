"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";

type Referral = {
  id: string;
  name: string;
  phone: string;
  status: "pending" | "booked" | "completed";
  dateReferred: string;
  rewardEarned?: number;
  firstVisitDate?: string;
};

const REFERRALS: Referral[] = [
  {
    id: "1",
    name: "Emma Wilson",
    phone: "•••• 4521",
    status: "completed",
    dateReferred: "Nov 10, 2025",
    rewardEarned: 15,
    firstVisitDate: "Nov 18, 2025",
  },
  {
    id: "2",
    name: "Sophie Chen",
    phone: "•••• 8834",
    status: "completed",
    dateReferred: "Oct 5, 2025",
    rewardEarned: 15,
    firstVisitDate: "Oct 12, 2025",
  },
  {
    id: "3",
    name: "Mia Johnson",
    phone: "•••• 2290",
    status: "booked",
    dateReferred: "Nov 28, 2025",
    firstVisitDate: "Dec 5, 2025",
  },
  {
    id: "4",
    name: "Olivia Brown",
    phone: "•••• 7763",
    status: "pending",
    dateReferred: "Dec 1, 2025",
  },
];

export default function MyReferralsPage() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleBack = () => {
    router.back();
  };

  const handleInviteMore = () => {
    router.push(`/${locale}/invite`);
  };

  const getStatusStyles = (status: Referral["status"]) => {
    switch (status) {
      case "completed":
        return {
          bg: "bg-gradient-to-r from-emerald-50 to-emerald-100",
          text: "text-emerald-700",
          border: "border-emerald-200",
          icon: "✓",
        };
      case "booked":
        return {
          bg: "bg-gradient-to-r from-blue-50 to-blue-100",
          text: "text-blue-700",
          border: "border-blue-200",
          icon: "📅",
        };
      case "pending":
        return {
          bg: "bg-gradient-to-r from-amber-50 to-amber-100",
          text: "text-amber-700",
          border: "border-amber-200",
          icon: "⏳",
        };
      default:
        return {
          bg: "bg-neutral-50",
          text: "text-neutral-700",
          border: "border-neutral-200",
          icon: "•",
        };
    }
  };

  const getStatusLabel = (status: Referral["status"]) => {
    switch (status) {
      case "completed":
        return "Reward Earned";
      case "booked":
        return "Visit Scheduled";
      case "pending":
        return "Invite Sent";
      default:
        return status;
    }
  };

  // Calculate stats
  const completedReferrals = REFERRALS.filter((r) => r.status === "completed");
  const totalEarned = completedReferrals.reduce(
    (sum, r) => sum + (r.rewardEarned || 0),
    0
  );
  const pendingRewards = REFERRALS.filter(
    (r) => r.status === "booked"
  ).length * 15;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f8f0e5] via-[#f6ebdd] to-[#f4e6d4] pb-10">
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4">
        {/* Top bar with back button */}
        <div
          className="pt-6 pb-2 relative flex items-center"
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
            <svg
              width="22"
              height="22"
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

          <div className="absolute left-1/2 transform -translate-x-1/2 text-lg font-semibold tracking-tight text-[#7b4ea3]">
            Nail Salon No.5
          </div>
        </div>

        {/* Title section */}
        <div
          className="text-center pt-4 pb-6"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(10px)",
            transition:
              "opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms",
          }}
        >
          <h1 className="text-3xl font-bold tracking-tight text-[#7b4ea3]">
            My Referrals
          </h1>
          <p className="text-base text-neutral-500 mt-1 italic">
            Share the love, earn rewards
          </p>
        </div>

        {/* Stats Summary Card */}
        <div
          className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-[#7b4ea3] to-[#5c3a7d] shadow-xl"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted
              ? "translateY(0) scale(1)"
              : "translateY(10px) scale(0.97)",
            transition:
              "opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms",
          }}
        >
          <div className="px-6 py-5">
            <div className="flex items-center justify-between">
              <div className="text-center flex-1">
                <div className="text-3xl font-bold text-white">
                  {REFERRALS.length}
                </div>
                <div className="text-sm text-white/70 mt-0.5">Friends Invited</div>
              </div>
              <div className="w-px h-12 bg-white/20" />
              <div className="text-center flex-1">
                <div className="text-3xl font-bold text-[#f4b864]">
                  ${totalEarned}
                </div>
                <div className="text-sm text-white/70 mt-0.5">Earned</div>
              </div>
              <div className="w-px h-12 bg-white/20" />
              <div className="text-center flex-1">
                <div className="text-3xl font-bold text-white/90">
                  ${pendingRewards}
                </div>
                <div className="text-sm text-white/70 mt-0.5">Pending</div>
              </div>
            </div>
          </div>
        </div>

        {/* How it works card */}
        <div
          className="mb-6 overflow-hidden rounded-2xl bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted
              ? "translateY(0) scale(1)"
              : "translateY(10px) scale(0.97)",
            transition:
              "opacity 300ms ease-out 200ms, transform 300ms ease-out 200ms",
          }}
        >
          <div
            className="h-1 bg-gradient-to-r from-[#d6a249] to-[#f4b864]"
            style={{
              width: mounted ? "100%" : "0%",
              transition: "width 500ms ease-out 300ms",
            }}
          />
          <div className="p-5">
            <h2 className="text-lg font-bold text-neutral-900 mb-4">
              How It Works
            </h2>
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-[#f6ebdd] flex items-center justify-center flex-shrink-0">
                  <span className="text-lg">💌</span>
                </div>
                <div>
                  <div className="font-semibold text-neutral-900">
                    Invite a Friend
                  </div>
                  <div className="text-sm text-neutral-500 mt-0.5">
                    Share your referral link or enter their number
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-[#f6ebdd] flex items-center justify-center flex-shrink-0">
                  <span className="text-lg">💅</span>
                </div>
                <div>
                  <div className="font-semibold text-neutral-900">
                    They Book & Visit
                  </div>
                  <div className="text-sm text-neutral-500 mt-0.5">
                    Your friend gets $10 off their first visit
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#f4b864] to-[#d6a249] flex items-center justify-center flex-shrink-0">
                  <span className="text-lg">🎁</span>
                </div>
                <div>
                  <div className="font-semibold text-neutral-900">
                    You Earn $15
                  </div>
                  <div className="text-sm text-neutral-500 mt-0.5">
                    Credit added automatically after their visit
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Invite More Button */}
        <button
          type="button"
          onClick={handleInviteMore}
          className="mb-6 w-full rounded-full bg-gradient-to-r from-[#f4b864] to-[#d6a249] px-6 py-4 text-lg font-bold text-neutral-900 shadow-lg transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-xl active:scale-[0.98]"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(10px)",
            transition:
              "opacity 300ms ease-out 250ms, transform 300ms ease-out 250ms",
          }}
        >
          Invite More Friends
        </button>

        {/* Referrals List */}
        <div
          className="mb-4"
          style={{
            opacity: mounted ? 1 : 0,
            transition: "opacity 300ms ease-out 300ms",
          }}
        >
          <h2 className="text-lg font-bold text-neutral-900 px-1 mb-3">
            Your Referrals
          </h2>
        </div>

        <div className="space-y-3">
          {REFERRALS.map((referral, index) => {
            const statusStyles = getStatusStyles(referral.status);
            return (
              <div
                key={referral.id}
                className="overflow-hidden rounded-2xl bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
                style={{
                  opacity: mounted ? 1 : 0,
                  transform: mounted
                    ? "translateY(0) scale(1)"
                    : "translateY(15px) scale(0.98)",
                  transition: `opacity 300ms ease-out ${350 + index * 60}ms, transform 300ms ease-out ${350 + index * 60}ms`,
                }}
              >
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    {/* Avatar and Name */}
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#e9d5f5] to-[#d4b8eb] flex items-center justify-center">
                        <span className="text-lg font-bold text-[#7b4ea3]">
                          {referral.name.charAt(0)}
                        </span>
                      </div>
                      <div>
                        <div className="font-bold text-neutral-900">
                          {referral.name}
                        </div>
                        <div className="text-sm text-neutral-500">
                          {referral.phone}
                        </div>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div
                      className={`px-3 py-1.5 rounded-full text-xs font-bold ${statusStyles.bg} ${statusStyles.text} border ${statusStyles.border}`}
                    >
                      {statusStyles.icon} {getStatusLabel(referral.status)}
                    </div>
                  </div>

                  {/* Details */}
                  <div className="mt-4 pt-3 border-t border-neutral-100">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-neutral-500">Invited</span>
                      <span className="font-medium text-neutral-700">
                        {referral.dateReferred}
                      </span>
                    </div>

                    {referral.firstVisitDate && (
                      <div className="flex justify-between items-center text-sm mt-2">
                        <span className="text-neutral-500">
                          {referral.status === "booked"
                            ? "Scheduled Visit"
                            : "First Visit"}
                        </span>
                        <span className="font-medium text-neutral-700">
                          {referral.firstVisitDate}
                        </span>
                      </div>
                    )}

                    {referral.rewardEarned && (
                      <div className="flex justify-between items-center mt-3 pt-3 border-t border-neutral-100">
                        <span className="font-semibold text-neutral-900">
                          Reward Earned
                        </span>
                        <span className="text-lg font-bold text-emerald-600">
                          +${referral.rewardEarned}
                        </span>
                      </div>
                    )}

                    {referral.status === "booked" && (
                      <div className="flex justify-between items-center mt-3 pt-3 border-t border-neutral-100">
                        <span className="font-semibold text-neutral-900">
                          Pending Reward
                        </span>
                        <span className="text-lg font-bold text-blue-600">
                          $15
                        </span>
                      </div>
                    )}

                    {referral.status === "pending" && (
                      <div className="mt-3 pt-3 border-t border-neutral-100">
                        <div className="text-sm text-amber-600 font-medium flex items-center gap-2">
                          <span>⏳</span>
                          <span>Waiting for them to book</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty state */}
        {REFERRALS.length === 0 && (
          <div className="overflow-hidden rounded-2xl bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
            <div className="text-center py-12 px-6">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-[#f6ebdd] to-[#f0dfc9] flex items-center justify-center">
                <span className="text-4xl">💌</span>
              </div>
              <p className="text-lg font-semibold text-neutral-700">
                No referrals yet
              </p>
              <p className="text-sm text-neutral-500 mt-1 mb-4">
                Invite friends and earn $15 for each one who visits!
              </p>
              <button
                type="button"
                onClick={handleInviteMore}
                className="rounded-full bg-[#f4b864] px-6 py-3 text-base font-bold text-neutral-900 shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
              >
                Start Inviting
              </button>
            </div>
          </div>
        )}

        {/* Bottom spacing */}
        <div className="h-6" />
      </div>
    </div>
  );
}

