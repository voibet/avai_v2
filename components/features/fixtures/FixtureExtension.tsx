import React from 'react';

interface FixtureExtensionProps {
  fixture: any;
}

interface ExtendedDataItem {
  id: string;
  label: string;
  home: string;
  away: string;
  info: string;
  show: boolean;
}

export function FixtureExtension({ fixture }: FixtureExtensionProps) {
  const extendedData: ExtendedDataItem[] = [
    {
      id: 'country',
      label: 'Team Country',
      home: fixture.home_country || '-',
      away: fixture.away_country || '-',
      info: '',
      show: true
    },
    {
      id: 'venue',
      label: 'Venue',
      home: '',
      away: '',
      info: fixture.venue_name || '-',
      show: true
    },
    {
      id: 'referee',
      label: 'Referee',
      home: '',
      away: '',
      info: fixture.referee || '-',
      show: true
    },
    {
      id: 'round',
      label: 'Round',
      home: '',
      away: '',
      info: fixture.round || '-',
      show: true
    },
    {
      id: 'status',
      label: 'Status',
      home: '',
      away: '',
      info: fixture.status_long || '-',
      show: true
    }
  ].filter(item => item.show);

  return (
    <div className="space-y-0">
      {/* INFO Section */}
      <div className="mt-2">
        <div className="grid grid-cols-5 gap-0 border-b border-gray-700">
          {/* Headers */}
          {extendedData.map((item) => (
            <div key={`header-${item.id}`} className="border-r border-gray-700 px-1 py-0.5 text-gray-300 font-bold text-[12px] bg-gray-900 font-mono truncate">
              {item.label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-0 border-b border-gray-700">
          {/* Values */}
          {extendedData.map((item) => (
            <div key={`value-${item.id}`} className="border-r border-gray-700 px-1 py-1 text-gray-100 text-[11px] font-mono truncate">
              {item.home && item.away ? `${item.home} - ${item.away}` : (item.home || item.away || item.info || '-')}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
