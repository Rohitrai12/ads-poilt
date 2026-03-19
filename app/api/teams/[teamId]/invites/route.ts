import { NextRequest, NextResponse } from "next/server"

import { verifyAuthToken } from "@/lib/auth"
import { ensureTeamSchema, generateId, generateToken } from "@/lib/teams"
import pool from "@/lib/mysql"

export const runtime = "nodejs"

const validRoles = new Set(["OWNER", "ADMIN", "MEMBER"])

function getUser(request: NextRequest) {
  const token = request.cookies.get("auth_token")?.value
  if (!token) return null
  return verifyAuthToken(token)
}

async function getRole(teamId: string, userId: number) {
  const [rows] = await pool.execute(
    "SELECT role FROM memberships WHERE team_id = ? AND user_id = ? LIMIT 1",
    [teamId, userId]
  )
  const row = (rows as Array<{ role: string }>)[0]
  return row?.role ?? null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const user = getUser(request)
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  }

  const { teamId } = await params

  await ensureTeamSchema()

  const role = await getRole(teamId, user.id)
  if (!role || (role !== "OWNER" && role !== "ADMIN")) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 })
  }

  const [rows] = await pool.execute(
    `
      SELECT id, email, token, role, expires_at AS expiresAt, created_at AS createdAt, accepted_at AS acceptedAt
      FROM invites
      WHERE team_id = ? AND accepted_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC
    `,
    [teamId]
  )

  return NextResponse.json({ invites: rows }, { status: 200 })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const user = getUser(request)
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  }

  const { teamId } = await params

  let body: { email?: string; role?: string }
  try {
    body = (await request.json()) as { email?: string; role?: string }
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase()
  const roleValue = (body.role ?? "MEMBER").toUpperCase()

  if (!email) {
    return NextResponse.json({ message: "Email is required" }, { status: 400 })
  }

  if (!validRoles.has(roleValue)) {
    return NextResponse.json({ message: "Invalid role" }, { status: 400 })
  }

  await ensureTeamSchema()

  const requesterRole = await getRole(teamId, user.id)
  if (!requesterRole || (requesterRole !== "OWNER" && requesterRole !== "ADMIN")) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 })
  }

  if (roleValue === "OWNER" && requesterRole !== "OWNER") {
    return NextResponse.json({ message: "Only owners can invite owners" }, { status: 403 })
  }

  const [existingInviteRows] = await pool.execute(
    `
      SELECT id, email, token, role, expires_at AS expiresAt
      FROM invites
      WHERE team_id = ? AND email = ? AND accepted_at IS NULL AND expires_at > NOW()
      LIMIT 1
    `,
    [teamId, email]
  )

  const existingInvite = (existingInviteRows as Array<{ id: string; email: string; token: string; role: string; expiresAt: string }>)[0]
  if (existingInvite) {
    return NextResponse.json(
      { invite: existingInvite },
      { status: 200 }
    )
  }

  const inviteId = generateId()
  const token = generateToken()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  await pool.execute(
    "INSERT INTO invites (id, email, team_id, token, role, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [inviteId, email, teamId, token, roleValue, expiresAt, user.id]
  )

  return NextResponse.json(
    {
      invite: { id: inviteId, email, token, role: roleValue, expiresAt },
    },
    { status: 201 }
  )
}
