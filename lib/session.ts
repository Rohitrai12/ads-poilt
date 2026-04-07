import type { NextRequest } from "next/server"

import { verifyAuthToken } from "@/lib/auth"

export function getAuthUserFromRequest(request: NextRequest) {
  const token = request.cookies.get("auth_token")?.value
  if (!token) return null
  return verifyAuthToken(token)
}

