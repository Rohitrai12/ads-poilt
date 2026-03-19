import { NextRequest, NextResponse } from "next/server"

import { verifyAuthToken } from "@/lib/auth"
import { ensureTeamSchema, generateId, withTransaction } from "@/lib/teams"
import pool from "@/lib/mysql"

export const runtime = "nodejs"

function getUser(request: NextRequest) {
  const token = request.cookies.get("auth_token")?.value
  if (!token) return null
  return verifyAuthToken(token)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const user = getUser(request)
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  }

  const { token } = await params

  await ensureTeamSchema()

  const result = await withTransaction(async (conn) => {
    const [rows] = await conn.execute(
      `
        SELECT id, email, team_id AS teamId, role, expires_at AS expiresAt, accepted_at AS acceptedAt
        FROM invites
        WHERE token = ?
        LIMIT 1
      `,
      [token]
    )

    const invite = (rows as Array<{ id: string; email: string; teamId: string; role: string; expiresAt: Date; acceptedAt: Date | null }>)[0]
    if (!invite) {
      return { status: 404, message: "Invite not found" }
    }

    if (invite.acceptedAt) {
      return { status: 400, message: "Invite already accepted" }
    }

    if (new Date(invite.expiresAt).getTime() < Date.now()) {
      return { status: 400, message: "Invite expired" }
    }

    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      return { status: 403, message: "Invite email does not match your account" }
    }

    const [membershipRows] = await conn.execute(
      "SELECT id FROM memberships WHERE team_id = ? AND user_id = ? LIMIT 1",
      [invite.teamId, user.id]
    )
    const existingMembership = (membershipRows as Array<{ id: string }>)[0]

    if (!existingMembership) {
      await conn.execute(
        "INSERT INTO memberships (id, user_id, team_id, role) VALUES (?, ?, ?, ?)",
        [generateId(), user.id, invite.teamId, invite.role]
      )
    }

    await conn.execute(
      "UPDATE invites SET accepted_at = NOW() WHERE id = ?",
      [invite.id]
    )

    return { status: 200, message: "Invite accepted" }
  })

  if (result.status !== 200) {
    return NextResponse.json({ message: result.message }, { status: result.status })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
