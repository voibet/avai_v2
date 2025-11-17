import { AdminTab } from '../../../types/admin';

interface Tab {
  id: AdminTab;
  label: string;
  icon: string;
}

interface TabNavigationProps {
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
}

const tabs: Tab[] = [
  { id: 'fetch-fixtures', label: 'Fetch Fixtures', icon: '' },
  { id: 'add-leagues', label: 'Add Leagues', icon: '' },
  { id: 'test', label: 'Test', icon: '' },
  { id: 'simulate', label: 'Simulate', icon: '' },
  { id: 'monitor', label: 'Monitor', icon: '' }
];

export default function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  return (
    <div className="flex space-x-1 mb-4 bg-gray-900 p-1 border border-gray-700">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`
            flex-1 py-1.5 px-2 font-mono text-xs transition-colors
            ${activeTab === tab.id
              ? 'bg-gray-700 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }
          `}
        >
          {tab.icon} {tab.label}
        </button>
      ))}
    </div>
  );
}
