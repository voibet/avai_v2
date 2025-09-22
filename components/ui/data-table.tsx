import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';


export interface Column<T> {
  key: string;
  header: string;
  span: number; // Number of columns (1-12) this column should span
  render: (item: T, index?: number) => React.ReactNode;
  className?: string;
  sortable?: boolean; // Defaults to true if not specified
  sortKey?: string; // If different from key, specify the field to sort by
  sortType?: 'string' | 'number' | 'date' | 'custom';
  customSort?: (a: T, b: T, direction: 'asc' | 'desc') => number;
}

export interface DataTableProps<T> {
  title: string;
  subtitle?: string;
  data: T[];
  columns: Column<T>[];
  getItemId: (item: T) => string | number;
  getItemHref?: (item: T) => string;
  emptyMessage?: string;
  className?: string;
  headerClassName?: string;
  rowClassName?: string;
  loading?: boolean;
  error?: string | null;
  // Selection support
  selectable?: boolean;
  selectedIds?: Set<string | number>;
  onSelectionChange?: (selectedIds: Set<string | number>) => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  // Filtering support
  filterable?: boolean;
  initialFilters?: Record<string, Set<string>>; // Initial filter state
  filterValueApi?: (field: string) => string | Promise<string[]>; // API URL or function returning values
  // Server-side callbacks
  onSort?: (sortKey: string, direction: 'asc' | 'desc') => void;
  onFilter?: (filters: Record<string, Set<string>>) => void;
  // Actions
  actions?: React.ReactNode;
  // Expandable rows support
  expandable?: boolean;
  renderExpandedContent?: (item: T, index?: number) => React.ReactNode;
  getExpandedRowClassName?: (item: T) => string;
  onRowExpand?: (itemId: string | number, isExpanded: boolean) => void;
}

export default function DataTable<T>({
  title,
  subtitle,
  data,
  columns,
  getItemId,
  getItemHref,
  emptyMessage = "No data found",
  className = "",
  headerClassName = "",
  rowClassName = "",
  loading = false,
  error = null,
  selectable = false,
  selectedIds = new Set(),
  onSelectionChange,
  onSelectAll,
  onClearSelection,
  actions,
  expandable = false,
  renderExpandedContent,
  getExpandedRowClassName,
  onRowExpand,
  filterable = true,
  initialFilters = {},
  filterValueApi,
  onSort,
  onFilter,
}: DataTableProps<T>) {
  const [expandedRows, setExpandedRows] = useState<Set<string | number>>(new Set());
  const [sortConfig, setSortConfig] = useState<{
    key: string;
    direction: 'asc' | 'desc';
    type: 'string' | 'number' | 'date' | 'custom';
  } | null>(null);
  const [filters, setFilters] = useState<Record<string, Set<string>>>(initialFilters);
  const [showFilterDropdown, setShowFilterDropdown] = useState<string | null>(null);
  const [filterSearchTerms, setFilterSearchTerms] = useState<Record<string, string>>({});

  // Update filters state when initialFilters prop changes
  useEffect(() => {
    setFilters(initialFilters);
  }, [initialFilters]); // Only runs when initialFilters reference changes
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close filter dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowFilterDropdown(null);
        // Clear search term when closing dropdown
        if (showFilterDropdown) {
          setFilterSearchTerms(prev => {
            const newTerms = { ...prev };
            delete newTerms[showFilterDropdown];
            return newTerms;
          });
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showFilterDropdown]);

  const handleItemSelect = (itemId: string | number) => {
    if (!onSelectionChange) return;

    const newSelected = new Set(selectedIds);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    onSelectionChange(newSelected);
  };

  const handleSelectAll = () => {
    if (onSelectAll) {
      onSelectAll();
    } else if (onSelectionChange) {
      const allIds = new Set(filteredData.map(item => getItemId(item)));
      onSelectionChange(allIds);
    }
  };

  const handleClearSelection = () => {
    if (onClearSelection) {
      onClearSelection();
    } else if (onSelectionChange) {
      onSelectionChange(new Set());
    }
  };

  const toggleRowExpansion = (itemId: string | number) => {
    const newExpanded = new Set(expandedRows);
    const wasExpanded = newExpanded.has(itemId);

    if (wasExpanded) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedRows(newExpanded);

    // Call the callback if provided
    if (onRowExpand) {
      onRowExpand(itemId, !wasExpanded);
    }
  };

  const expandAllRows = () => {
    setExpandedRows(new Set(filteredData.map(item => getItemId(item))));
  };

  const collapseAllRows = () => {
    setExpandedRows(new Set());
  };

  const handleSort = (column: Column<T>) => {
    if (column.sortable === false) return;

    const sortKey = column.sortKey || column.key;
    const sortType = column.sortType || 'string';

    let newDirection: 'asc' | 'desc' = 'asc';
    if (sortConfig?.key === sortKey) {
      // Toggle direction if same column
      newDirection = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    }

    setSortConfig({
      key: sortKey,
      direction: newDirection,
      type: sortType
    });

    // Call server-side sort callback if provided
    if (onSort) {
      onSort(sortKey, newDirection);
    }
  };

  const getSortValue = (item: T, column: Column<T>): any => {
    const sortKey = column.sortKey || column.key;

    // If custom sort function is provided, use it
    if (column.customSort) {
      return item;
    }

    // Handle different data structures
    if (typeof item === 'object' && item !== null) {
      // If it's an array-like object or has the key directly
      if (sortKey in item) {
        return (item as any)[sortKey];
      }

      // Handle nested properties with dot notation
      const keys = sortKey.split('.');
      let value: any = item;

      for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
          value = value[key];
        } else {
          // For debugging - you can uncomment this to see what values are being extracted
          // console.log('Sort key not found:', sortKey, 'in item:', item);
          // Return appropriate default based on sort type
          const sortType = columns.find(col => (col.sortKey || col.key) === sortKey)?.sortType || 'string';
          return sortType === 'number' ? 0 : '';
        }
      }

      return value;
    }

    // If item is not an object, return it directly
    return item;
  };

  const sortData = (data: T[]): T[] => {
    // If server-side sorting is enabled, don't sort client-side
    if (onSort) return data;

    if (!sortConfig) return data;

    const column = columns.find(col => (col.sortKey || col.key) === sortConfig.key);
    if (!column) return data;

    return [...data].sort((a, b) => {
      // Use custom sort function if provided
      if (column.customSort) {
        return column.customSort(a, b, sortConfig.direction);
      }

      const aValue = getSortValue(a, column);
      const bValue = getSortValue(b, column);

      // Debug logging (uncomment to troubleshoot sorting issues)
      // if (sortConfig.type === 'number') {
      //   console.log('Sorting numbers:', { aValue, bValue, a: a, b: b });
      // }

      let comparison = 0;

      switch (sortConfig.type) {
        case 'number':
          // Handle various number formats and edge cases
          let aNum: number, bNum: number;

          if (typeof aValue === 'number' && !isNaN(aValue)) {
            aNum = aValue;
          } else if (typeof aValue === 'string') {
            aNum = parseFloat(aValue.replace(/[^\d.-]/g, '')) || 0;
          } else {
            aNum = 0;
          }

          if (typeof bValue === 'number' && !isNaN(bValue)) {
            bNum = bValue;
          } else if (typeof bValue === 'string') {
            bNum = parseFloat(bValue.replace(/[^\d.-]/g, '')) || 0;
          } else {
            bNum = 0;
          }

          comparison = aNum - bNum;
          break;

        case 'date':
          const aDate = new Date(aValue);
          const bDate = new Date(bValue);

          // Handle invalid dates
          if (isNaN(aDate.getTime()) && isNaN(bDate.getTime())) {
            comparison = 0;
          } else if (isNaN(aDate.getTime())) {
            comparison = 1; // b comes first
          } else if (isNaN(bDate.getTime())) {
            comparison = -1; // a comes first
          } else {
            comparison = aDate.getTime() - bDate.getTime();
          }
          break;

        case 'string':
        default:
          const aStr = String(aValue || '').toLowerCase();
          const bStr = String(bValue || '').toLowerCase();
          comparison = aStr.localeCompare(bStr);
          break;
      }

      return sortConfig.direction === 'desc' ? -comparison : comparison;
    });
  };

  // State for filter values from API
  const [apiFilterValues, setApiFilterValues] = useState<Record<string, string[]>>({});
  const [loadingFilterValues, setLoadingFilterValues] = useState<Set<string>>(new Set());

  // Effect to load filter values when dropdown opens
  useEffect(() => {
    if (showFilterDropdown && filterValueApi) {
      const column = columns.find(col => col.key === showFilterDropdown);
      if (column) {
        const fieldKey = column.sortKey || column.key;
        if (!apiFilterValues[fieldKey] && !loadingFilterValues.has(fieldKey)) {
          fetchFilterValues(column);
        }
      }
    }
  }, [showFilterDropdown, filterValueApi, columns]);

  // Fetch filter values from API when needed
  const fetchFilterValues = async (column: Column<T>): Promise<string[]> => {
    const fieldKey = column.sortKey || column.key;

    if (!filterValueApi) {
      // Fallback to computing from current data
      const values = new Set<string>();
      data.forEach(item => {
        const value = getSortValue(item, column);
        if (value !== null && value !== undefined && value !== '') {
          values.add(String(value));
        }
      });
      return Array.from(values).sort();
    }

    // Check if we already have cached values
    if (apiFilterValues[fieldKey]) {
      return apiFilterValues[fieldKey];
    }

    // Check if we're already loading this field
    if (loadingFilterValues.has(fieldKey)) {
      return [];
    }

    try {
      setLoadingFilterValues(prev => new Set(prev).add(fieldKey));

      const apiResult = filterValueApi(fieldKey);

      if (typeof apiResult === 'string') {
        // It's a URL, fetch from it
        const response = await fetch(apiResult);
        if (!response.ok) {
          throw new Error(`Failed to fetch filter values for ${fieldKey}`);
        }
        const data = await response.json();
        const values = data.values || [];
        setApiFilterValues(prev => ({ ...prev, [fieldKey]: values }));
        return values;
      } else {
        // It's a promise that returns values directly
        const values = await apiResult;
        setApiFilterValues(prev => ({ ...prev, [fieldKey]: values }));
        return values;
      }
    } catch (error) {
      console.error(`Error fetching filter values for ${fieldKey}:`, error);
      // Fallback to computing from current data
      const values = new Set<string>();
      data.forEach(item => {
        const value = getSortValue(item, column);
        if (value !== null && value !== undefined && value !== '') {
          values.add(String(value));
        }
      });
      return Array.from(values).sort();
    } finally {
      setLoadingFilterValues(prev => {
        const newSet = new Set(prev);
        newSet.delete(fieldKey);
        return newSet;
      });
    }
  };


  const toggleFilterValue = (columnKey: string, value: string) => {
    setFilters(prev => {
      const columnFilters = prev[columnKey] || new Set<string>();

      let newFilters: Record<string, Set<string>>;
      if (columnFilters.has(value)) {
        // If clicking the same value, remove it (clear the filter for this column)
        const { [columnKey]: removed, ...rest } = prev;
        newFilters = rest;
      } else {
        // Replace any existing value with the new one (single value per column)
        newFilters = {
          ...prev,
          [columnKey]: new Set([value])
        };
      }

      // Call server-side filter callback if provided
      if (onFilter) {
        onFilter(newFilters);
      }

      return newFilters;
    });
  };

  const clearColumnFilter = (columnKey: string) => {
    setFilters(prev => {
      const { [columnKey]: removed, ...rest } = prev;
      // Call server-side filter callback if provided
      if (onFilter) {
        onFilter(rest);
      }
      return rest;
    });
  };

  const clearAllFilters = () => {
    setFilters({});
    // Call server-side filter callback if provided
    if (onFilter) {
      onFilter({});
    }
  };

  const handleFilterSearchChange = (columnKey: string, searchTerm: string) => {
    setFilterSearchTerms(prev => ({
      ...prev,
      [columnKey]: searchTerm
    }));
  };

  const applyFilters = (data: T[]): T[] => {
    // If server-side filtering is enabled, don't filter client-side
    if (onFilter) return data;

    if (Object.keys(filters).length === 0) return data;

    return data.filter(item => {
      return Object.entries(filters).every(([columnKey, filterValues]) => {
        const column = columns.find(col => col.key === columnKey);
        if (!column) return true;

        const itemValue = getSortValue(item, column);
        return filterValues.has(String(itemValue));
      });
    });
  };

  const sortedData = sortData(data);
  const filteredData = applyFilters(sortedData);

  if (loading) {
    return (
      <div className="space-y-1">
        <div className="flex justify-between items-center py-2 border-b border-gray-600">
          <h1 className="text-lg font-bold text-gray-200 font-mono">{title}</h1>
          <span className="text-gray-400 text-xs font-mono">Loading...</span>
        </div>
        <div className="py-8 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-green-400"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-1">
        <div className="flex justify-between items-center py-2 border-b border-gray-600">
          <h1 className="text-lg font-bold text-red-400 font-mono">{title}</h1>
          <span className="text-gray-400 text-xs font-mono">Error</span>
        </div>
        <div className="py-4 border-b border-gray-600">
          <span className="text-red-400 text-xs font-mono">{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-1 ${className}`} style={{ pointerEvents: 'none' }}>
      {/* Header */}
      <div className={`flex justify-between items-center py-2 border-b border-gray-600 ${headerClassName}`}>
        <h1 className="text-lg font-bold text-gray-200 font-mono">{title}</h1>
        <div className="flex items-center gap-4">
          {expandable && (
            <div className="flex items-center gap-2">
              <span className={`text-xs font-mono ${expandedRows.size > 0 ? 'text-purple-400' : 'text-gray-500'}`}>
                {expandedRows.size > 0 ? `${expandedRows.size} expanded` : 'Click rows to expand'}
              </span>
              {filteredData.length > 1 && (
                <>
                  <button
                    onClick={expandAllRows}
                    disabled={expandedRows.size === filteredData.length}
                    className="text-blue-400 hover:text-blue-300 disabled:text-gray-600 disabled:cursor-not-allowed text-xs font-mono underline"
                    style={{ pointerEvents: 'auto' }}
                  >
                    Expand All
                  </button>
                  <button
                    onClick={collapseAllRows}
                    disabled={expandedRows.size === 0}
                    className="text-blue-400 hover:text-blue-300 disabled:text-gray-600 disabled:cursor-not-allowed text-xs font-mono underline"
                    style={{ pointerEvents: 'auto' }}
                  >
                    Collapse All
                  </button>
                </>
              )}
            </div>
          )}
          {selectable && selectedIds.size > 0 && (
            <span className="text-blue-400 text-xs font-mono">
              {selectedIds.size} selected
            </span>
          )}
          {subtitle && (
            <span className="text-gray-400 text-xs font-mono">{subtitle}</span>
          )}
          <span className="text-gray-400 text-xs font-mono">
            {filteredData.length} total
            {sortConfig ? ' (sorted)' : ''}
            {Object.keys(filters).length > 0 ? ` (${Object.keys(filters).length} filtered)` : ''}
          </span>
          {Object.keys(filters).length > 0 && (
            <button
              onClick={clearAllFilters}
              className="text-red-400 hover:text-red-300 text-xs font-mono underline ml-2"
              style={{ pointerEvents: 'auto' }}
            >
              Clear Filters
            </button>
          )}
          {actions && (
            <div className="ml-4" style={{ pointerEvents: 'auto' }}>
              {actions}
            </div>
          )}
        </div>
      </div>

      {/* Column Headers */}
      <div ref={dropdownRef} className={`relative grid ${expandable && selectable ? 'grid-cols-15' : expandable || selectable ? 'grid-cols-14' : 'grid-cols-13'} gap-1 py-1 bg-gray-800 border-b border-gray-600 text-xs font-mono font-bold text-white`}>
        {selectable && (
          <div className="col-span-1">
            <input
              type="checkbox"
              checked={selectedIds.size === filteredData.length && filteredData.length > 0}
              onChange={(e) => {
                if (e.target.checked) {
                  handleSelectAll();
                } else {
                  handleClearSelection();
                }
              }}
              className="rounded border-gray-600 bg-gray-700 text-red-600 focus:ring-red-600"
              style={{ pointerEvents: 'auto' }}
            />
          </div>
        )}
        {columns.map((column) => {
          const sortKey = column.sortKey || column.key;
          const isSorted = sortConfig?.key === sortKey;
          const isSortable = column.sortable !== false; // Defaults to true
          const hasFilter = filters[column.key]?.size > 0;
          const isFilterable = filterable !== false && column.key !== 'actions';

          return (
            <div
              key={column.key}
              className={`col-span-${column.span} ${column.className || ''} relative ${
                isSortable ? 'cursor-pointer hover:bg-gray-700 transition-colors' : ''
              }`}
              onClick={() => isSortable && handleSort(column)}
              style={{ pointerEvents: isSortable ? 'auto' : 'none' }}
            >
              <div className="flex items-center gap-1">
                <span>{column.header}</span>
                <div className="flex items-center gap-1">
                  {isSortable && (
                    <span className="text-xs">
                      {isSorted ? (
                        sortConfig.direction === 'asc' ? '↑' : '↓'
                      ) : (
                        <span className="text-gray-500">↕</span>
                      )}
                    </span>
                  )}
                  {isFilterable && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowFilterDropdown(showFilterDropdown === column.key ? null : column.key);
                      }}
                      className={`text-xs px-1 hover:bg-gray-600 rounded transition-colors ${
                        hasFilter ? 'text-yellow-400' : 'text-gray-500'
                      }`}
                      title={hasFilter ? `Filtered (${filters[column.key]?.size} selected)` : 'Filter'}
                      style={{ pointerEvents: 'auto' }}
                    >
                      {hasFilter ? '⚫' : '○'}
                    </button>
                  )}
                </div>
              </div>

              {/* Filter Dropdown */}
              {showFilterDropdown === column.key && isFilterable && (
                <div className="absolute top-full left-0 mt-1 z-40 bg-gray-800 border border-gray-600 rounded shadow-lg min-w-48 max-h-80 overflow-hidden">
                  <div className="p-2 border-b border-gray-600">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono text-white">Filter {column.header}</span>
                      {hasFilter && (
                        <button
                          onClick={() => clearColumnFilter(column.key)}
                          className="text-xs text-red-400 hover:text-red-300 font-mono"
                          style={{ pointerEvents: 'auto' }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      placeholder="Search..."
                      value={filterSearchTerms[column.key] || ''}
                      onChange={(e) => handleFilterSearchChange(column.key, e.target.value)}
                      className="w-full px-2 py-1 bg-gray-700 border border-gray-600 text-white text-xs font-mono rounded focus:outline-none focus:border-blue-400"
                      onClick={(e) => e.stopPropagation()}
                      style={{ pointerEvents: 'auto' }}
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {(() => {
                      const fieldKey = column.sortKey || column.key;
                      const values = apiFilterValues[fieldKey] || [];
                      const isLoading = loadingFilterValues.has(fieldKey);
                      const searchTerm = filterSearchTerms[column.key] || '';

                      if (isLoading) {
                        return (
                          <div className="px-2 py-1 text-xs font-mono text-gray-500">
                            Loading...
                          </div>
                        );
                      }

                      if (values.length === 0) {
                        return (
                          <div className="px-2 py-1 text-xs font-mono text-gray-500">
                            No values available
                          </div>
                        );
                      }

                      // Filter values based on search term
                      const filteredValues = searchTerm
                        ? values.filter(value =>
                            value.toLowerCase().includes(searchTerm.toLowerCase())
                          )
                        : values;

                      if (filteredValues.length === 0) {
                        return (
                          <div className="px-2 py-1 text-xs font-mono text-gray-500">
                            No matches found
                          </div>
                        );
                      }

                      return filteredValues.map((value) => {
                        const isSelected = filters[column.key]?.has(value) ?? false;
                        return (
                          <label
                            key={value}
                            className="flex items-center gap-2 px-2 py-1 hover:bg-gray-700 cursor-pointer"
                            style={{ pointerEvents: 'auto' }}
                          >
                            <input
                              type="radio"
                              name={`filter-${column.key}`}
                              checked={isSelected}
                              onChange={() => toggleFilterValue(column.key, value)}
                              className="rounded-full border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-600"
                              style={{ pointerEvents: 'auto' }}
                            />
                            <span className="text-xs font-mono text-gray-300 truncate">
                              {value}
                            </span>
                          </label>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Data Rows */}
      <div className="space-y-0">
        {data.length === 0 ? (
          <div className="py-4 border-b border-gray-600">
            <span className="text-gray-500 text-xs font-mono">{emptyMessage}</span>
          </div>
        ) : (
          filteredData.map((item, index) => {
            const itemId = getItemId(item);
            const href = getItemHref?.(item);
            const isExpanded = expandedRows.has(itemId);

            const RowContent = (
              <div
                className={`grid ${expandable && selectable ? 'grid-cols-15' : expandable || selectable ? 'grid-cols-14' : 'grid-cols-13'} gap-1 py-1 border-b border-gray-600 text-xs font-mono ${rowClassName} ${expandable ? 'cursor-pointer hover:bg-gray-800' : ''}`}
                onClick={expandable ? () => toggleRowExpansion(itemId) : undefined}
                style={{ pointerEvents: expandable ? 'auto' : 'none' }}
              >
                {selectable && (
                  <div className="col-span-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(itemId)}
                      onChange={() => handleItemSelect(itemId)}
                      className="rounded border-gray-600 bg-gray-700 text-red-600 focus:ring-red-600"
                      style={{ pointerEvents: 'auto' }}
                    />
                  </div>
                )}
                {columns.map((column) => (
                  <div
                    key={`${itemId}-${column.key}`}
                    className={`col-span-${column.span} ${column.className || ''}`}
                  >
                    {column.render(item, index)}
                  </div>
                ))}
              </div>
            );

            const ExpandedContent = isExpanded && renderExpandedContent ? (
              <div className={`border-b border-gray-700 ${getExpandedRowClassName?.(item) || 'bg-gray-850'}`} style={{ pointerEvents: 'auto' }}>
                {renderExpandedContent(item, index)}
              </div>
            ) : null;

            if (href) {
              return (
                <div key={itemId}>
                  <Link
                    href={href}
                    className="block"
                    onClick={expandable ? (e) => {
                      // If expandable, prevent navigation and toggle expansion instead
                      e.preventDefault();
                      toggleRowExpansion(itemId);
                    } : undefined}
                  >
                    {RowContent}
                  </Link>
                  {ExpandedContent}
                </div>
              );
            }

            return (
              <div key={itemId}>
                <div className="hover:bg-gray-800 transition-colors">
                  {RowContent}
                </div>
                {ExpandedContent}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
