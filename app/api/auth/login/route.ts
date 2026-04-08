// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from "next/server"

import { authenticateUser, signAuthToken } from "@/lib/auth"
import { getBillingSnapshotByUserId, toBillingView } from "@/lib/billing"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const { email, password } = (await request.json()) as {
      email?: string
      password?: string
    }

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      )
    }

    const user = await authenticateUser(email.toLowerCase().trim(), password)

    if (!user) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      )
    }

    const snapshot = await getBillingSnapshotByUserId(user.id)
    const billing = toBillingView(snapshot)
    if (!billing.hasActiveSubscription) {
      return NextResponse.json(
        {
          error: "Payment required before login. Please choose a plan and complete checkout.",
          code: "PAYMENT_REQUIRED",
          next: `/?checkout=1&email=${encodeURIComponent(user.email)}#pricing`,
        },
        { status: 402 }
      )
    }

    const token = signAuthToken(user)

    const response = NextResponse.json(
      { user: { email: user.email, name: user.name } },
      { status: 200 }
    )

    response.cookies.set("auth_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })

    return response
  } catch (error) {
    console.error("Login error:", error)

    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    )
  }
}