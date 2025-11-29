import NextAuth from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import pool from "@/lib/database/db"
import bcrypt from "bcrypt"

// Simple in-memory rate limiter
const loginAttempts = new Map<string, { count: number, lastAttempt: number }>()

const handler = NextAuth({
    providers: [
        CredentialsProvider({
            name: "Credentials",
            credentials: {
                username: { label: "Username", type: "text" },
                password: { label: "Password", type: "password" }
            },
            async authorize(credentials) {
                if (!credentials?.username || !credentials?.password) {
                    return null
                }

                const username = credentials.username.toLowerCase()
                const now = Date.now()

                // Check rate limit
                const userAttempts = loginAttempts.get(username) || { count: 0, lastAttempt: 0 }

                // Reset attempts if last attempt was more than 15 minutes ago
                if (now - userAttempts.lastAttempt > 15 * 60 * 1000) {
                    userAttempts.count = 0
                }

                // Block if too many attempts (5 attempts per 15 mins)
                if (userAttempts.count >= 5) {
                    throw new Error("Too many login attempts. Please try again later.")
                }

                try {
                    // Add artificial delay to slow down brute force (500ms - 1000ms)
                    await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 500))

                    const result = await pool.query(
                        "SELECT * FROM users WHERE username = $1",
                        [credentials.username]
                    )

                    const user = result.rows[0]

                    if (!user) {
                        // Record failed attempt
                        loginAttempts.set(username, {
                            count: userAttempts.count + 1,
                            lastAttempt: now
                        })
                        return null
                    }

                    const passwordMatch = await bcrypt.compare(
                        credentials.password,
                        user.password_hash
                    )

                    if (passwordMatch) {
                        // Reset attempts on successful login
                        loginAttempts.delete(username)
                        return {
                            id: user.id.toString(),
                            name: user.username,
                        }
                    } else {
                        // Record failed attempt
                        loginAttempts.set(username, {
                            count: userAttempts.count + 1,
                            lastAttempt: now
                        })
                        return null
                    }
                } catch (error) {
                    console.error("Auth error:", error)
                    return null
                }
            }
        })
    ],
    pages: {
        signIn: '/login',
    },
    session: {
        strategy: "jwt",
    },
    secret: process.env.NEXTAUTH_SECRET,
})

export { handler as GET, handler as POST }
