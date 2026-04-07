import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"

import { updateSubscriptionFromStripe } from "@/lib/billing"
import { getStripe } from "@/lib/stripe"

export const runtime = "nodejs"

function fromUnix(seconds?: number | null) {
  if (!seconds) return null
  return new Date(seconds * 1000)
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

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = event.data.object as Stripe.Subscription
    const priceId = sub.items.data[0]?.price?.id ?? null
    await updateSubscriptionFromStripe({
      customerId: String(sub.customer),
      subscriptionId: sub.id,
      priceId,
      status: sub.status,
      trialEndsAt: fromUnix(sub.trial_end),
      currentPeriodEnd: fromUnix(sub.items.data[0]?.current_period_end ?? null),
    })
  }

  return NextResponse.json({ received: true }, { status: 200 })
}

