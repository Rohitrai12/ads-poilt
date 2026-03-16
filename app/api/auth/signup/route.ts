// app/api/auth/signup/route.ts
import { NextRequest, NextResponse } from "next/server"

import { createUser, signAuthToken } from "@/lib/auth"

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

    const token = signAuthToken(user)

    const response = NextResponse.json(
      { user: { email: user.email, name: user.name } },
      { status: 201 }
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