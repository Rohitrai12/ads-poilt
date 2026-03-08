import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"

import clientPromise from "./mongodb"

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  throw new Error("Please define the JWT_SECRET environment variable in your .env.local file.")
}
// Capture as a non-optional value for JWT typings.
const JWT_SECRET_VALUE: string = JWT_SECRET

type DbUser = {
  _id: string
  email: string
  name?: string
  password: string
  createdAt: Date
}

export type AuthUser = {
  id: string
  email: string
  name?: string
}

export async function getUsersCollection() {
  const client = await clientPromise
  const db = client.db()
  return db.collection<DbUser>("users")
}

export async function createUser(
  email: string,
  password: string,
  name?: string
): Promise<AuthUser> {
  const users = await getUsersCollection()

  const existing = await users.findOne({ email })
  if (existing) {
    throw new Error("USER_EXISTS")
  }

  const hashedPassword = await bcrypt.hash(password, 10)

  const result = await users.insertOne({
    email,
    ...(name && { name: name.trim() }),
    password: hashedPassword,
    createdAt: new Date(),
  } as unknown as DbUser)

  return {
    id: result.insertedId.toString(),
    email,
    ...(name && { name: name.trim() }),
  }
}

export async function authenticateUser(
  email: string,
  password: string
): Promise<AuthUser | null> {
  const users = await getUsersCollection()
  const user = await users.findOne({ email })

  if (!user) return null

  const isValid = await bcrypt.compare(password, user.password)
  if (!isValid) return null

  return {
    id: (user as any)._id.toString(),
    email: user.email,
    ...(user.name && { name: user.name }),
  }
}

export function signAuthToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      ...(user.name && { name: user.name }),
    },
    JWT_SECRET_VALUE,
    {
      expiresIn: "7d",
    }
  )
}

export function verifyAuthToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET_VALUE) as jwt.JwtPayload

    if (!payload.sub || typeof payload.email !== "string") {
      return null
    }

    return {
      id: String(payload.sub),
      email: payload.email,
      ...(typeof payload.name === "string" && { name: payload.name }),
    }
  } catch {
    return null
  }
}

