// components/MetaAccountPicker.tsx
"use client";

import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
export type MetaAdAccount = {
  id: string;        // e.g. "act_123456"
  name: string;
  account_status: number; // 1 = active
  currency: string;
  timezone_name?: string;
  business?: { id: string; name: string };
};

export type MetaPage = {
  id: string;
  name: string;
  category?: string;
  picture?: { data: { url: string } };
};

export type MetaPixel = {
  id: string;
  name: string;
  ad_account_id: string;
  last_fired_time?: string;
};

export type MetaSelection = {
  accessToken: string;
  adAccount: MetaAdAccount;
  page: MetaPage | null;
  pixel: MetaPixel | null;
};

type Props = {
  accessToken: string;
  adAccounts: MetaAdAccount[];
  pages: MetaPage[];
  pixels: MetaPixel[];
  onConfirm: (selection: MetaSelection) => void;
  onCancel: () => void;
};

// ─── Status label ─────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: "Active", color: "text-emerald-400" },
  2: { label: "Disabled", color: "text-red-400" },
  3: { label: "Unsettled", color: "text-yellow-400" },
  7: { label: "Pending review", color: "text-yellow-400" },
  9: { label: "In grace period", color: "text-yellow-400" },
  100: { label: "Pending closure", color: "text-zinc-500" },
  101: { label: "Closed", color: "text-zinc-500" },
};

function MetaIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="white">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

// ─── Step indicator ────────────────────────────────────────────────────────────
function StepDot({ step, current, label }: { step: number; current: number; label: string }) {
  const done = current > step;
  const active = current === step;
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
          done
            ? "bg-emerald-500 text-white"
            : active
            ? "bg-[#1877f2] text-white"
            : "bg-zinc-800 text-zinc-600"
        }`}
      >
        {done ? "✓" : step}
      </div>
      <span
        className={`text-[11px] font-medium ${
          active ? "text-zinc-200" : done ? "text-emerald-400" : "text-zinc-600"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export function MetaAccountPicker({
  accessToken,
  adAccounts,
  pages,
  pixels,
  onConfirm,
  onCancel,
}: Props) {
  const [step, setStep] = useState(1); // 1=ad account, 2=page, 3=pixel
  const [selectedAccount, setSelectedAccount] = useState<MetaAdAccount | null>(null);
  const [selectedPage, setSelectedPage] = useState<MetaPage | null>(null);
  const [selectedPixel, setSelectedPixel] = useState<MetaPixel | null>(null);

  // Pixels filtered to the selected ad account
  const accountPixels = selectedAccount
    ? pixels.filter((p) => p.ad_account_id === selectedAccount.id)
    : [];

  const handleConfirm = () => {
    if (!selectedAccount) return;
    onConfirm({
      accessToken,
      adAccount: selectedAccount,
      page: selectedPage,
      pixel: selectedPixel,
    });
  };

  return (
    // Backdrop
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
        style={{ animation: "slideUp .2s ease-out" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1877f2]">
            <MetaIcon size={16} />
          </div>
          <div>
            <div className="text-sm font-bold text-zinc-100">Connect Meta Ads</div>
            <div className="text-[11px] text-zinc-500">
              {adAccounts.length} ad account{adAccounts.length !== 1 ? "s" : ""} found
            </div>
          </div>
          <button
            onClick={onCancel}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-3 border-b border-zinc-800 px-5 py-3">
          <StepDot step={1} current={step} label="Ad Account" />
          <div className="h-px flex-1 bg-zinc-800" />
          <StepDot step={2} current={step} label="Page" />
          <div className="h-px flex-1 bg-zinc-800" />
          <StepDot step={3} current={step} label="Pixel" />
        </div>

        {/* Step content */}
        <div className="max-h-[360px] overflow-y-auto px-4 py-3">

          {/* ── Step 1: Ad Account ──────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-2">
              <p className="mb-3 text-xs text-zinc-500">
                Select the ad account you want to manage:
              </p>
              {adAccounts.length === 0 && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-6 text-center text-xs text-zinc-500">
                  No ad accounts found. Make sure your Facebook account has access to at least one ad account.
                </div>
              )}
              {adAccounts.map((acct) => {
                const status = STATUS_LABELS[acct.account_status] ?? { label: "Unknown", color: "text-zinc-500" };
                const isSelected = selectedAccount?.id === acct.id;
                return (
                  <button
                    key={acct.id}
                    onClick={() => setSelectedAccount(acct)}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition-all ${
                      isSelected
                        ? "border-[#1877f2]/60 bg-[#1877f2]/10"
                        : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-900"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-zinc-200">
                          {acct.name}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {acct.id} · {acct.currency}
                          {acct.timezone_name && ` · ${acct.timezone_name}`}
                        </div>
                        {acct.business && (
                          <div className="text-[10px] text-zinc-600">
                            Business: {acct.business.name}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`text-[10px] font-semibold ${status.color}`}>
                          {status.label}
                        </span>
                        {isSelected && (
                          <div className="flex h-4 w-4 items-center justify-center rounded-full bg-[#1877f2]">
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Step 2: Facebook Page ───────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-2">
              <p className="mb-3 text-xs text-zinc-500">
                Select the Facebook Page to run ads from (required for creating ads):
              </p>
              {/* "Skip" option */}
              <button
                onClick={() => setSelectedPage(null)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition-all ${
                  selectedPage === null
                    ? "border-zinc-700 bg-zinc-800/60"
                    : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
                }`}
              >
                <div className="text-sm font-medium text-zinc-400">Skip for now</div>
                <div className="text-[11px] text-zinc-600">You&apos;ll need a Page ID when creating ads</div>
              </button>

              {pages.length === 0 && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-4 text-center text-xs text-zinc-500">
                  No Pages found. You may not manage any Facebook Pages, or pages permission was not granted.
                </div>
              )}

              {pages.map((page) => {
                const isSelected = selectedPage?.id === page.id;
                return (
                  <button
                    key={page.id}
                    onClick={() => setSelectedPage(page)}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition-all ${
                      isSelected
                        ? "border-[#1877f2]/60 bg-[#1877f2]/10"
                        : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-900"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {page.picture?.data.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={page.picture.data.url}
                          alt={page.name}
                          className="h-9 w-9 rounded-lg object-cover border border-zinc-700"
                        />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800 text-lg">
                          📄
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-zinc-200">{page.name}</div>
                        <div className="text-[11px] text-zinc-500">
                          ID: {page.id}
                          {page.category && ` · ${page.category}`}
                        </div>
                      </div>
                      {isSelected && (
                        <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#1877f2]">
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Step 3: Pixel ───────────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-2">
              <p className="mb-3 text-xs text-zinc-500">
                Select a Meta Pixel for conversion tracking (optional):
              </p>

              {/* "Skip" option */}
              <button
                onClick={() => setSelectedPixel(null)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition-all ${
                  selectedPixel === null
                    ? "border-zinc-700 bg-zinc-800/60"
                    : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
                }`}
              >
                <div className="text-sm font-medium text-zinc-400">Skip for now</div>
                <div className="text-[11px] text-zinc-600">You can use pixels when creating audiences</div>
              </button>

              {accountPixels.length === 0 && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-4 text-center text-xs text-zinc-500">
                  No pixels found for <span className="text-zinc-400">{selectedAccount?.name}</span>.
                </div>
              )}

              {accountPixels.map((pixel) => {
                const isSelected = selectedPixel?.id === pixel.id;
                const lastFired = pixel.last_fired_time
                  ? new Date(pixel.last_fired_time).toLocaleDateString()
                  : "Never fired";
                return (
                  <button
                    key={pixel.id}
                    onClick={() => setSelectedPixel(pixel)}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition-all ${
                      isSelected
                        ? "border-[#1877f2]/60 bg-[#1877f2]/10"
                        : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-900"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-zinc-200">
                          {pixel.name}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          ID: {pixel.id} · Last fired: {lastFired}
                        </div>
                      </div>
                      {isSelected && (
                        <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#1877f2]">
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 px-5 py-4">
          <button
            onClick={step === 1 ? onCancel : () => setStep((s) => s - 1)}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            {step === 1 ? "Cancel" : "← Back"}
          </button>

          {step < 3 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={step === 1 && !selectedAccount}
              className="flex items-center gap-1.5 rounded-lg bg-[#1877f2] px-5 py-2 text-xs font-bold text-white hover:bg-[#166fe5] disabled:opacity-30 transition-colors"
            >
              Next →
            </button>
          ) : (
            <button
              onClick={handleConfirm}
              disabled={!selectedAccount}
              className="flex items-center gap-1.5 rounded-lg bg-[#1877f2] px-5 py-2 text-xs font-bold text-white hover:bg-[#166fe5] disabled:opacity-30 transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Connect
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
      `}</style>
    </div>
  );
}