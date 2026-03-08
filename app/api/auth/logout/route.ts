import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function POST() {
  const response = NextResponse.json({ success: true }, { status: 200 })

  response.cookies.set("auth_token", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  })

  return response
}

