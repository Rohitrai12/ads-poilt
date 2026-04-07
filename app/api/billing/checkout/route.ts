import { NextRequest, NextResponse } from "next/server"

import { ensureStripeCustomerForUser } from "@/lib/billing"
import { getAuthUserFromRequest } from "@/lib/session"
import { getStripe } from "@/lib/stripe"

export const runtime = "nodejs"

function getAppUrl(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin
}

export async function POST(request: NextRequest) {
  try {
    const user = getAuthUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = (await request.json().catch(() => ({}))) as { plan?: "pro" | "agency" }
    const plan = body.plan ?? "pro"
    const priceId = plan === "agency" ? process.env.STRIPE_PRICE_AGENCY : process.env.STRIPE_PRICE_PRO
    if (!priceId) return NextResponse.json({ error: "Stripe price id not configured" }, { status: 500 })

    const stripe = getStripe()
    const customerId = await ensureStripeCustomerForUser(user)
    const appUrl = getAppUrl(request)
    const trialDays = Number(process.env.STRIPE_TRIAL_DAYS ?? 7)

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

