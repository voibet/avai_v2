import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"

export default withAuth(
    // Custom middleware function
    function middleware(req) {
        // 1. CORS / Origin Check
        // Only allow requests from allowed domains
        const host = req.headers.get("host")
        const origin = req.headers.get("origin")

        // Define allowed domains
        const allowedDomains = ["localhost:3005", ".avai.fi"]

        // Check Host header
        const isAllowedHost = allowedDomains.some(domain =>
            host?.includes(domain) || host === domain
        )

        if (!isAllowedHost) {
            return new NextResponse("Forbidden: Invalid Host", { status: 403 })
        }

        // Check Origin header (if present, usually on POST requests)
        if (origin) {
            const isAllowedOrigin = allowedDomains.some(domain =>
                origin.includes(domain)
            )
            if (!isAllowedOrigin) {
                return new NextResponse("Forbidden: Invalid Origin", { status: 403 })
            }
        }

        // Return next-auth's default response (continue)
        return NextResponse.next()
    },
    {
        pages: {
            signIn: "/login",
        },
    }
)

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api/auth (auth API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - login (login page)
         */
        "/((?!api/auth|_next/static|_next/image|favicon.ico|login).*)",
    ],
}
