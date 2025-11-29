'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const router = useRouter()

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')

        const result = await signIn('credentials', {
            username,
            password,
            redirect: false,
        })

        if (result?.error) {
            setError('ACCESS DENIED')
        } else {
            router.push('/')
            router.refresh()
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-black text-gray-300 font-mono">
            <div className="w-full max-w-sm p-6 border border-gray-700 bg-gray-900/50">
                <h1 className="text-xl font-bold mb-6 text-white uppercase tracking-wider border-b border-gray-700 pb-2">
                    System Login
                </h1>

                {error && (
                    <div className="mb-4 text-red-500 text-sm font-bold">
                        [{error}]
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs uppercase mb-1 text-gray-500">Username</label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full bg-black border border-gray-700 p-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                            autoFocus
                        />
                    </div>

                    <div>
                        <label className="block text-xs uppercase mb-1 text-gray-500">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-black border border-gray-700 p-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                        />
                    </div>

                    <button
                        type="submit"
                        className="w-full bg-gray-800 hover:bg-gray-700 text-blue-400 font-bold py-2 px-4 border border-gray-600 hover:border-gray-500 mt-4 uppercase text-sm transition-colors"
                    >
                        Log In
                    </button>
                </form>
            </div>
        </div>
    )
}
