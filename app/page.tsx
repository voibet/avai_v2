import Link from 'next/link'

export default function Home() {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Link href="/fixtures">
          <div className="bg-gray-800 border border-gray-600 p-3 hover:bg-gray-700 transition-colors">
            <h2 className="text-lg font-bold text-white font-mono">FIXTURES</h2>
            <p className="text-gray-400 text-xs font-mono mt-1">All past and future fixtures</p>
          </div>
        </Link>
        <Link href="/admin">
          <div className="bg-red-900/20 border border-red-600 p-3 hover:bg-red-900/30 transition-colors">
            <h2 className="text-lg font-bold text-red-400 font-mono">ADMIN</h2>
            <p className="text-gray-400 text-xs font-mono mt-1">System administration</p>
          </div>
        </Link>
      </div>
    </div>
  )
}

