import pool from "@/lib/mysql"
import type { AuthUser } from "@/lib/auth"
import { getStripe } from "@/lib/stripe"

export type BillingStatus = "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "incomplete" | "free"

export type BillingSnapshot = {
  userId: number
  planTier: PlanTier
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripePriceId: string | null
  subscriptionStatus: string | null
  usageMonth: string | null
  monthlyMessageCount: number
  monthlyReportCount: number
  trialEndsAt: string | null
  currentPeriodEnd: string | null
}

export type PlanTier = "free" | "pro" | "agency"

export type PlanLimits = {
  adAccountsLimit: number | "unlimited"
  allowedPlatforms: number
  monthlyAiMessages: number | "unlimited"
  monthlyAiReports: number | "unlimited"
  allowCrossPlatformDashboard: boolean
  allowCampaignEdits: boolean
  allowWhiteLabelReports: boolean
  allowMultiClientDashboard: boolean
  dedicatedOnboarding: boolean
  slackSupport: boolean
}

export type BillingView = {
  status: BillingStatus
  planTier: PlanTier
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  hasActiveSubscription: boolean
  limits: PlanLimits
  usage: {
    month: string
    monthlyMessageCount: number
    monthlyReportCount: number
  }
}

const ACTIVE_STATUSES = new Set(["trialing", "active"])
const EDIT_TOOL_PREFIXES = ["meta_create_", "meta_update_", "meta_bulk_", "google_create_", "google_update_", "google_bulk_"]

const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    adAccountsLimit: 1,
    allowedPlatforms: 1,
    monthlyAiMessages: 50,
    monthlyAiReports: 1,
    allowCrossPlatformDashboard: false,
    allowCampaignEdits: false,
    allowWhiteLabelReports: false,
    allowMultiClientDashboard: false,
    dedicatedOnboarding: false,
    slackSupport: false,
  },
  pro: {
    adAccountsLimit: 5,
    allowedPlatforms: 3,
    monthlyAiMessages: "unlimited",
    monthlyAiReports: "unlimited",
    allowCrossPlatformDashboard: true,
    allowCampaignEdits: true,
    allowWhiteLabelReports: false,
    allowMultiClientDashboard: false,
    dedicatedOnboarding: false,
    slackSupport: false,
  },
  agency: {
    adAccountsLimit: "unlimited",
    allowedPlatforms: 3,
    monthlyAiMessages: "unlimited",
    monthlyAiReports: "unlimited",
    allowCrossPlatformDashboard: true,
    allowCampaignEdits: true,
    allowWhiteLabelReports: true,
    allowMultiClientDashboard: true,
    dedicatedOnboarding: true,
    slackSupport: true,
  },
}

const REPORT_KEYWORDS = /\b(report|summary|weekly report|monthly report|performance report)\b/i

function currentMonth() {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

function detectPlanFromPriceId(priceId: string | null): PlanTier {
  if (!priceId) return "free"
  if (priceId === process.env.STRIPE_PRICE_AGENCY) return "agency"
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro"
  return "free"
}

export function isEditingTool(toolName: string): boolean {
  return EDIT_TOOL_PREFIXES.some((p) => toolName.startsWith(p))
}

export function toIso(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "string") return value
  return null
}

export async function getBillingSnapshotByUserId(userId: number): Promise<BillingSnapshot> {
  const [rows] = await pool.execute(
    `SELECT id, stripe_customer_id, stripe_subscription_id, stripe_price_id, subscription_status, trial_ends_at, current_period_end
            , plan_tier, usage_month, monthly_message_count, monthly_report_count
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [userId]
  )
  const row = (
    rows as Array<{
      id: number
      stripe_customer_id: string | null
      stripe_subscription_id: string | null
      stripe_price_id: string | null
      subscription_status: string | null
      plan_tier: string | null
      usage_month: string | null
      monthly_message_count: number | null
      monthly_report_count: number | null
      trial_ends_at: Date | string | null
      current_period_end: Date | string | null
    }>
  )[0]
  return {
    userId: row.id,
    planTier: ((row.plan_tier ?? "free") as PlanTier),
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripePriceId: row.stripe_price_id,
    subscriptionStatus: row.subscription_status,
    usageMonth: row.usage_month,
    monthlyMessageCount: row.monthly_message_count ?? 0,
    monthlyReportCount: row.monthly_report_count ?? 0,
    trialEndsAt: toIso(row.trial_ends_at),
    currentPeriodEnd: toIso(row.current_period_end),
  }
}

export function toBillingView(snapshot: BillingSnapshot): BillingView {
  const status = (snapshot.subscriptionStatus ?? "free") as BillingStatus
  const month = snapshot.usageMonth ?? currentMonth()
  const planTier = ACTIVE_STATUSES.has(status) ? (snapshot.planTier ?? "free") : "free"
  return {
    status,
    planTier,
    trialEndsAt: snapshot.trialEndsAt,
    currentPeriodEnd: snapshot.currentPeriodEnd,
    hasActiveSubscription: ACTIVE_STATUSES.has(status),
    limits: PLAN_LIMITS[planTier],
    usage: {
      month,
      monthlyMessageCount: snapshot.monthlyMessageCount,
      monthlyReportCount: snapshot.monthlyReportCount,
    },
  }
}

export async function requireActiveSubscription(user: AuthUser) {
  const snapshot = await getBillingSnapshotByUserId(user.id)
  const view = toBillingView(snapshot)
  if (!view.hasActiveSubscription) {
    return { ok: false as const, billing: view }
  }
  return { ok: true as const, billing: view, snapshot }
}

export async function getPlanContext(user: AuthUser) {
  const snapshot = await getBillingSnapshotByUserId(user.id)
  const month = currentMonth()
  if (snapshot.usageMonth !== month) {
    await pool.execute(
      "UPDATE users SET usage_month = ?, monthly_message_count = 0, monthly_report_count = 0 WHERE id = ?",
      [month, user.id]
    )
    snapshot.usageMonth = month
    snapshot.monthlyMessageCount = 0
    snapshot.monthlyReportCount = 0
  }
  const view = toBillingView(snapshot)
  return {
    snapshot,
    view,
    limits: PLAN_LIMITS[view.planTier],
  }
}

export async function consumeMessageQuota(userId: number, isReport: boolean) {
  const month = currentMonth()
  await pool.execute(
    `UPDATE users
     SET usage_month = ?,
         monthly_message_count = IF(usage_month = ?, monthly_message_count + 1, 1),
         monthly_report_count = IF(usage_month = ?, monthly_report_count + ?, ?)
     WHERE id = ?`,
    [month, month, month, isReport ? 1 : 0, isReport ? 1 : 0, userId]
  )
}

export function isReportPrompt(text: string) {
  return REPORT_KEYWORDS.test(text)
}

export async function ensureStripeCustomerForUser(user: AuthUser): Promise<string> {
  const snapshot = await getBillingSnapshotByUserId(user.id)
  if (snapshot.stripeCustomerId) return snapshot.stripeCustomerId
  const stripe = getStripe()
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { appUserId: String(user.id) },
  })
  await pool.execute("UPDATE users SET stripe_customer_id = ? WHERE id = ?", [customer.id, user.id])
  return customer.id
}

export async function updateSubscriptionFromStripe(args: {
  customerId: string
  subscriptionId: string | null
  priceId: string | null
  status: string | null
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null
}) {
  await pool.execute(
    `UPDATE users
     SET stripe_subscription_id = ?, stripe_price_id = ?, subscription_status = ?, plan_tier = ?, trial_ends_at = ?, current_period_end = ?
     WHERE stripe_customer_id = ?`,
    [
      args.subscriptionId,
      args.priceId,
      args.status,
      detectPlanFromPriceId(args.priceId),
      args.trialEndsAt,
      args.currentPeriodEnd,
      args.customerId,
    ]
  )
}

