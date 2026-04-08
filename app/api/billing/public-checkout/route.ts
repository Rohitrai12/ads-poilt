import { NextRequest, NextResponse } from "next/server"

import pool from "@/lib/mysql"
import { getUserByEmail } from "@/lib/auth"
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
    const body = (await request.json().catch(() => ({}))) as {
      plan?: "starter" | "growth" | "agency"
      email?: string
    }
    const plan = body.plan
    const email = body.email?.toLowerCase().trim()
    if (!plan || !email) return NextResponse.json({ error: "Plan and email are required" }, { status: 400 })

    const user = await getUserByEmail(email)
    if (!user) return NextResponse.json({ error: "Account not found. Please sign up first." }, { status: 404 })

    const priceId = await resolvePriceId(plan)
    if (!priceId) return NextResponse.json({ error: "Stripe price id not configured" }, { status: 500 })

    const trialDays =
      plan === "starter"
        ? Number(process.env.STRIPE_TRIAL_DAYS_STARTER ?? 7)
        : Number(process.env.STRIPE_TRIAL_DAYS_GROWTH_AGENCY ?? process.env.STRIPE_TRIAL_DAYS ?? 14)

    const stripe = getStripe()
    const customer =
      user.stripeCustomerId
        ? await stripe.customers.retrieve(user.stripeCustomerId)
        : await stripe.customers.create({
            email: user.email,
            name: user.name ?? undefined,
            metadata: { appUserId: String(user.id) },
          })

    if (!("id" in customer)) {
      return NextResponse.json({ error: "Unable to resolve Stripe customer" }, { status: 500 })
    }

    if (!user.stripeCustomerId) {
      await pool.execute("UPDATE users SET stripe_customer_id = ? WHERE id = ?", [customer.id, user.id])
    }

    const appUrl = getAppUrl(request)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { plan_tier: plan, app_user_email: user.email },
      success_url: `${appUrl}/login?paid=1`,
      cancel_url: `${appUrl}/?checkout=1&email=${encodeURIComponent(user.email)}#pricing`,
      subscription_data: {
        trial_period_days: trialDays,
        metadata: { plan_tier: plan, app_user_email: user.email },
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
