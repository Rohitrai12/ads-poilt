// lib/mongodb.ts
import { MongoClient, MongoClientOptions } from "mongodb"

const uri = process.env.MONGODB_URI
if (!uri) {
  throw new Error("Please define the MONGODB_URI environment variable in your .env.local file.")
}
const options: MongoClientOptions = {
  tls: true,
  // Relaxes cert validation in dev only — never in production
  tlsAllowInvalidCertificates: process.env.NODE_ENV === "development",
  // Fail fast (avoid 25-30s hangs in API routes)
  serverSelectionTimeoutMS: 8000,
  connectTimeoutMS: 8000,
}

let client: MongoClient
let clientPromise: Promise<MongoClient>

if (process.env.NODE_ENV === "development") {
  const globalWithMongo = global as typeof globalThis & {
    _mongoClientPromise?: Promise<MongoClient>
  }
  if (!globalWithMongo._mongoClientPromise) {
    client = new MongoClient(uri, options)
    globalWithMongo._mongoClientPromise = client.connect()
  }
  clientPromise = globalWithMongo._mongoClientPromise
} else {
  client = new MongoClient(uri, options)
  clientPromise = client.connect()
}

export default clientPromise