import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
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
          <nav className="bg-gray-900 border-b border-gray-700 px-4 py-2 sticky top-0" style={{ zIndex: 2147483647 }}>
            <div className="container mx-auto flex items-center justify-between">
              <a href="/" className="text-lg font-bold text-gray-200 hover:text-gray-400 transition-colors pointer-events-auto" style={{ zIndex: 2147483647 }}>
                DATABASE
              </a>
              <div className="flex space-x-6 text-sm">
                <a href="/fixtures" className="text-gray-300 hover:text-white transition-colors pointer-events-auto" style={{ zIndex: 2147483647 }}>FIXTURES</a>
                <a href="/admin" className="text-gray-300 hover:text-white transition-colors pointer-events-auto" style={{ zIndex: 2147483647 }}>ADMIN</a>
              </div>
            </div>
          </nav>
          <main className="container mx-auto px-2 py-4 max-w-7xl">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}

