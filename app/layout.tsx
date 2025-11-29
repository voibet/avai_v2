import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Link from 'next/link'
import UserMenu from '@/components/UserMenu'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Football Database',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-black text-white font-mono">
          <nav className="bg-black border-b border-gray-700 px-4 py-1.5 sticky top-0" style={{ zIndex: 2147483647 }}>
            <div className="container mx-auto flex items-center justify-between">
              <Link href="/" className="text-base font-bold text-gray-300 hover:text-gray-200 transition-colors pointer-events-auto" style={{ zIndex: 2147483647 }}>
                DATABASE
              </Link>
              <div className="flex space-x-6 text-xs">
                <Link href="/fixtures" className="text-gray-400 hover:text-white transition-colors pointer-events-auto" style={{ zIndex: 2147483647 }}>FIXTURES</Link>
                <Link href="/trading" className="text-gray-400 hover:text-white transition-colors pointer-events-auto" style={{ zIndex: 2147483647 }}>TRADING</Link>
                <Link href="/admin" className="text-gray-400 hover:text-white transition-colors pointer-events-auto" style={{ zIndex: 2147483647 }}>ADMIN</Link>
                <UserMenu />
              </div>
            </div>
          </nav>
          <main className="container mx-auto px-2 py-2 max-w-7xl mt-10">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}

