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

    const stripe = getStripe()
    const customerId = await ensureStripeCustomerForUser(user)
    const appUrl = getAppUrl(request)
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/dashboard/billing`,
    })
    return NextResponse.json({ url: session.url }, { status: 200 })
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to create billing portal session", details: String(err) },
      { status: 500 }
    )
  }
}

