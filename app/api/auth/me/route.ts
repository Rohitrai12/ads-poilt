// app/api/auth/me/route.ts
import { NextRequest, NextResponse } from "next/server"

import { verifyAuthToken } from "@/lib/auth"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const token = request.cookies.get("auth_token")?.value

  if (!token) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  const user = verifyAuthToken(token)

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  return NextResponse.json({ user }, { status: 200 })
}