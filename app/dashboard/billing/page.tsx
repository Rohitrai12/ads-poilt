"use client"

import { useEffect, useState } from "react"

type Billing = {
  status: string
  planTier: "free" | "starter" | "growth" | "agency"
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  hasActiveSubscription: boolean
  limits: {
    adAccountsLimit: number | "unlimited"
    allowedPlatforms: number
    allowGoogleAds: boolean
    monthlyAiMessages: number | "unlimited"
    monthlyAiReports: number | "unlimited"
    allowCrossPlatformDashboard: boolean
    allowCampaignEdits: boolean
  }
  usage: {
    month: string
    monthlyMessageCount: number
    monthlyReportCount: number
  }
}

function fmtDate(iso: string | null) {
  if (!iso) return "N/A"
  return new Date(iso).toLocaleDateString()
}

export default function BillingPage() { 
  const [billing, setBilling] = useState<Billing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function refresh() {
    const res = await fetch("/api/billing/status")
    if (!res.ok) return
    const data = (await res.json()) as { billing: Billing }
    setBilling(data.billing)
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function startCheckout(plan: "starter" | "growth" | "agency") {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      })
      const raw = await res.text()
      const data = raw ? (JSON.parse(raw) as { url?: string; error?: string; details?: string }) : {}
      if (!res.ok) {
        setError(data.details ? `${data.error ?? "Checkout failed"}: ${data.details}` : (data.error ?? "Checkout failed"))
        return
      }
      if (data.url) window.location.href = data.url
    } finally {
      setLoading(false)
    }
  }

  async function openPortal() {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" })
      const raw = await res.text()
      const data = raw ? (JSON.parse(raw) as { url?: string; error?: string; details?: string }) : {}
      if (!res.ok) {
        setError(data.details ? `${data.error ?? "Portal failed"}: ${data.details}` : (data.error ?? "Portal failed"))
        return
      }
      if (data.url) window.location.href = data.url
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Billing</h1>
      <div className="rounded-lg border p-4 text-sm space-y-2">
        <div>Plan: <span className="font-medium uppercase">{billing?.planTier ?? "free"}</span></div>
        <div>Status: <span className="font-medium uppercase">{billing?.status ?? "loading"}</span></div>
        <div>Trial ends: <span className="font-medium">{fmtDate(billing?.trialEndsAt ?? null)}</span></div>
        <div>Current period end: <span className="font-medium">{fmtDate(billing?.currentPeriodEnd ?? null)}</span></div>
        <div>Messages this month: <span className="font-medium">{billing?.usage.monthlyMessageCount ?? 0}</span></div>
        <div>Reports this month: <span className="font-medium">{billing?.usage.monthlyReportCount ?? 0}</span></div>
      </div>
      <div className="rounded-lg border p-4 text-sm space-y-1">
        <div className="font-medium">Plan Limits</div>
        <div>Ad accounts: {String(billing?.limits.adAccountsLimit ?? 1)}</div>
        <div>Platforms: {billing?.limits.allowedPlatforms ?? 1}</div>
        <div>AI messages/month: {String(billing?.limits.monthlyAiMessages ?? 50)}</div>
        <div>AI reports/month: {String(billing?.limits.monthlyAiReports ?? 1)}</div>
        <div>Cross-platform dashboard: {billing?.limits.allowCrossPlatformDashboard ? "Yes" : "No"}</div>
        <div>Campaign edits via AI: {billing?.limits.allowCampaignEdits ? "Yes" : "No"}</div>
      </div>
      <div className="flex gap-2">
        <button disabled={loading} onClick={() => startCheckout("starter")} className="rounded-md bg-black text-white px-3 py-2 text-sm disabled:opacity-50">
          Start Starter ($49/month, 7-day trial)
        </button>
        <button disabled={loading} onClick={() => startCheckout("growth")} className="rounded-md border px-3 py-2 text-sm disabled:opacity-50">
          Start Growth ($79/month, 14-day trial)
        </button>
        <button disabled={loading} onClick={() => startCheckout("agency")} className="rounded-md border px-3 py-2 text-sm disabled:opacity-50">
          Start Agency ($179/month, 14-day trial)
        </button>
        <button disabled={loading} onClick={openPortal} className="rounded-md border px-3 py-2 text-sm disabled:opacity-50">
          Open billing portal
        </button>
      </div>
      {error && <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
    </div>
  )
}