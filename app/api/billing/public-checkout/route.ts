import { NextRequest, NextResponse } from "next/server"

import pool from "@/lib/mysql"
import { getUserByEmail } from "@/lib/auth"
import { getStripe } from "@/lib/stripe"

export const runtime = "nodejs"

function getAppUrl(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin
}

async function resolvePriceId(plan: "starter" | "growth" | "agency") {
  const direct =
    plan === "starter"
      ? process.env.STRIPE_PRICE_STARTER
      : plan === "agency"
        ? process.env.STRIPE_PRICE_AGENCY
        : (process.env.STRIPE_PRICE_GROWTH ?? process.env.STRIPE_PRICE_PRO)
  if (direct) return direct

  const productId =
    plan === "starter"
      ? process.env.STRIPE_PRODUCT_STARTER
      : plan === "agency"
        ? process.env.STRIPE_PRODUCT_AGENCY
        : process.env.STRIPE_PRODUCT_GROWTH
  if (!productId) return null

  const stripe = getStripe()
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 1 })
  return prices.data[0]?.id ?? null
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
