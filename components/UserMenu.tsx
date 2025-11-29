'use client'

import { signOut } from "next-auth/react"

export default function UserMenu() {
    return (
        <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="text-gray-400 hover:text-red-400 transition-colors pointer-events-auto ml-6"
        >
            LOGOUT
        </button>
    )
}
