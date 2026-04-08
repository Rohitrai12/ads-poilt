// app/api/auth/signup/route.ts
import { NextRequest, NextResponse } from "next/server"

import { createUser } from "@/lib/auth"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    let body: { email?: string; password?: string; name?: string }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      )
    }

    const { email, password, name } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      )
    }

    const user = await createUser(email.toLowerCase().trim(), password, name)
    return NextResponse.json(
      {
        user: { email: user.email, name: user.name },
        next: `/?checkout=1&email=${encodeURIComponent(user.email)}#pricing`,
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof Error && error.message === "USER_EXISTS") {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      )
    }

    console.error("Signup error:", error)

    const isDev = process.env.NODE_ENV === "development"
    const message =
      isDev && error instanceof Error
        ? error.message
        : "Something went wrong. Please try again."

    return NextResponse.json({ error: message }, { status: 500 })
  }
}