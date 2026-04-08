import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"

import { detectPlanFromPriceId, updateSubscriptionFromStripe } from "@/lib/billing"
import { getStripe } from "@/lib/stripe"

export const runtime = "nodejs"

function fromUnix(seconds?: number | null) {
  if (!seconds) return null
  return new Date(seconds * 1000)
}

function normalizeMetadataTier(tier: string | null): "free" | "starter" | "growth" | "agency" | null {
  if (!tier) return null
  if (tier === "pro") return "growth"
  if (tier === "free" || tier === "starter" || tier === "growth" || tier === "agency") return tier
  return null
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) return NextResponse.json({ error: "Missing webhook secret" }, { status: 500 })

  const payload = await request.text()
  const signature = request.headers.get("stripe-signature")
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 })

  const stripe = getStripe()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret)
  } catch (err) {
    return NextResponse.json({ error: `Invalid signature: ${String(err)}` }, { status: 400 })
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : null
    const customerId = typeof session.customer === "string" ? session.customer : null
    if (subscriptionId && customerId) {
      const sub = await stripe.subscriptions.retrieve(subscriptionId)
      const priceId = sub.items.data[0]?.price?.id ?? null
      const metadataTier = normalizeMetadataTier((sub.metadata?.plan_tier ?? session.metadata?.plan_tier ?? null) as string | null)
      await updateSubscriptionFromStripe({
        customerId,
        subscriptionId: sub.id,
        priceId,
        status: sub.status,
        trialEndsAt: fromUnix(sub.trial_end),
        currentPeriodEnd: fromUnix(sub.items.data[0]?.current_period_end ?? null),
        planTier: metadataTier ?? detectPlanFromPriceId(priceId),
      })
    }
  } else if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = event.data.object as Stripe.Subscription
    const priceId = sub.items.data[0]?.price?.id ?? null
    const metadataTier = normalizeMetadataTier((sub.metadata?.plan_tier ?? null) as string | null)
    await updateSubscriptionFromStripe({
      customerId: String(sub.customer),
      subscriptionId: sub.id,
      priceId,
      status: sub.status,
      trialEndsAt: fromUnix(sub.trial_end),
      currentPeriodEnd: fromUnix(sub.items.data[0]?.current_period_end ?? null),
      planTier: metadataTier ?? detectPlanFromPriceId(priceId),
    })
  }

  return NextResponse.json({ received: true }, { status: 200 })
}

