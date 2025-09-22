import React from 'react';

interface League {
  id: number;
  name: string;
  country: string;
  seasons: Record<string, { start: string; end: string; current: boolean }>;
  xg_source: Record<string, { rounds: Record<string, { url: string }> }> | null;
}

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  league: League | null;
  isLoading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function DeleteConfirmationModal({
  isOpen,
  league,
  isLoading,
  onClose,
  onConfirm
}: DeleteConfirmationModalProps) {
  if (!isOpen || !league) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-40">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-md w-full">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-red-400 font-mono">
            Delete League
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl"
          >
            ×
          </button>
        </div>

        <div className="mb-6">
          <div className="text-sm text-gray-300 mb-4">
            Are you sure you want to delete the league <span className="text-white font-mono font-semibold">"{league.name}"</span>?
          </div>

          <div className="bg-red-900/20 border border-red-700 rounded p-3 mb-4">
            <div className="text-sm text-red-300 font-semibold mb-2">⚠️ This action cannot be undone!</div>
            <ul className="text-sm text-gray-300 space-y-1">
              <li>• All fixtures for this league will be permanently deleted</li>
              <li>• All odds data will be removed</li>
              <li>• All predictions and statistics will be deleted</li>
              <li>• League configuration and seasons will be removed</li>
            </ul>
          </div>

          <div className="text-xs text-gray-400">
            League ID: <span className="text-gray-500 font-mono">{league.id}</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-800 text-white font-mono text-sm transition-colors"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="px-4 py-2 bg-red-800 hover:bg-red-900 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-mono text-sm transition-colors"
          >
            {isLoading ? 'Deleting...' : 'Delete League'}
          </button>
        </div>
      </div>
    </div>
  );
}
