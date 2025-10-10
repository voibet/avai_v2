import Link from 'next/link'

const NavCard = ({ href, title, color }: { href: string; title: string; color: 'blue' | 'red' }) => {
  const colorClasses = {
    blue: 'bg-gray-800/50 border-gray-600 hover:bg-gray-700/50 hover:border-gray-500 text-blue-400 hover:text-blue-300',
    red: 'bg-red-900/10 border-red-700/50 hover:bg-red-900/20 hover:border-red-600 text-red-400 hover:text-red-300'
  }

  return (
    <Link href={href}>
      <div className={`${colorClasses[color]} border p-6 transition-all duration-200 group cursor-pointer`}>
        <h2 className="text-xl font-bold font-mono group-hover:transition-colors">{title}</h2>
      </div>
    </Link>
  )
}

export default function Home() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <NavCard href="/fixtures" title="FIXTURES" color="blue" />
      <NavCard href="/admin" title="ADMIN" color="red" />
    </div>
  )
}

