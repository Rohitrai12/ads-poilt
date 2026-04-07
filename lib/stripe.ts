import Stripe from "stripe"

export const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2025-03-31.basil"

let stripeClient: Stripe | null = null

export function getStripe() {
  if (stripeClient) return stripeClient
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set")
  }
  stripeClient = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
  })
  return stripeClient
}

