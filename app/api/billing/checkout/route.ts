import { NextRequest, NextResponse } from "next/server"

import { ensureStripeCustomerForUser } from "@/lib/billing"
import { getAuthUserFromRequest } from "@/lib/session"
import { getStripe } from "@/lib/stripe"

export const runtime = "nodejs"

function getAppUrl(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin
}

function isLikelyRealPriceId(value: string | undefined) {
  return typeof value === "string" && /^price_[A-Za-z0-9]+$/.test(value) && value.length > 12
}

async function resolvePriceId(plan: "starter" | "growth" | "agency") {
  const stripe = getStripe()

  const direct =
    plan === "starter"
      ? process.env.STRIPE_PRICE_STARTER
      : plan === "agency"
        ? process.env.STRIPE_PRICE_AGENCY
        : (process.env.STRIPE_PRICE_GROWTH ?? process.env.STRIPE_PRICE_PRO)
  if (isLikelyRealPriceId(direct)) return direct as string

  const configuredProductId =
    plan === "starter"
      ? (process.env.STRIPE_PRODUCT_STARTER ?? process.env.STRIPE_PRODUCT_STARTER_ID)
      : plan === "agency"
        ? (process.env.STRIPE_PRODUCT_AGENCY ?? process.env.STRIPE_PRODUCT_AGENCY_ID)
        : (process.env.STRIPE_PRODUCT_GROWTH ?? process.env.STRIPE_PRODUCT_GROWTH_ID)

  if (configuredProductId) {
    const prices = await stripe.prices.list({ product: configuredProductId, active: true, limit: 10 })
    const recurringMonthly = prices.data.find((p) => p.type === "recurring" && p.recurring?.interval === "month")
    if (recurringMonthly?.id) return recurringMonthly.id
    if (prices.data[0]?.id) return prices.data[0].id
  }

  const expectedName = plan === "starter" ? "Starter" : plan === "growth" ? "Growth" : "Agency"
  const products = await stripe.products.list({ active: true, limit: 100 })
  const productByName = products.data.find((p) => p.name?.toLowerCase() === expectedName.toLowerCase())
  if (productByName?.default_price && typeof productByName.default_price === "string") {
    return productByName.default_price
  }

  return null
}

export async function POST(request: NextRequest) {
  try {
    const user = getAuthUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = (await request.json().catch(() => ({}))) as { plan?: "starter" | "growth" | "agency" }
    const plan = body.plan ?? "growth"
    const priceId = await resolvePriceId(plan)
    if (!priceId) return NextResponse.json({ error: "Stripe price id not configured" }, { status: 500 })

    const stripe = getStripe()
    const customerId = await ensureStripeCustomerForUser(user)
    const appUrl = getAppUrl(request)
    const trialDays =
      plan === "starter"
        ? Number(process.env.STRIPE_TRIAL_DAYS_STARTER ?? 7)
        : Number(process.env.STRIPE_TRIAL_DAYS_GROWTH_AGENCY ?? process.env.STRIPE_TRIAL_DAYS ?? 14)

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { plan_tier: plan },
      success_url: `${appUrl}/dashboard/billing?checkout=success`,
      cancel_url: `${appUrl}/dashboard/billing?checkout=cancelled`,
      subscription_data: {
        trial_period_days: trialDays,
        metadata: { plan_tier: plan },
      },
      allow_promotion_codes: true,
    })

    return NextResponse.json({ url: session.url }, { status: 200 })
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create checkout session", details: String(err) },
      { status: 500 }
    )
  }
}

