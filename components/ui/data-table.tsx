import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';


export interface Column<T> {
  key: string;
  header: string;
  span: number; // Number of columns (1-12) this column should span
  render: (item: T, index?: number) => React.ReactNode;
  className?: string;
  sortable?: boolean; // Defaults to true if not specified
  filterable?: boolean; // Defaults to true if not specified
  sortKey?: string; // If different from key, specify the field to sort by
  sortType?: 'string' | 'number' | 'date' | 'custom';
  customSort?: (a: T, b: T, direction: 'asc' | 'desc') => number;
}

export interface DataTableProps<T> {
  title: string;
  subtitle?: string;
  columns: Column<T>[];
  getItemId: (item: T) => string | number;
  getItemHref?: (item: T) => string;
  emptyMessage?: string;
  className?: string;
  headerClassName?: string;
  rowClassName?: string;
  // Selection support
  selectable?: boolean;
  selectedIds?: Set<string | number>;
  onSelectionChange?: (selectedIds: Set<string | number>) => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  // Filtering support
  filterable?: boolean;
  currentFilters?: Record<string, Set<string>>; // Current filter state from URL
  onFilterChange?: (columnKey: string, value: string | null) => void; // Callback to update URL
  onClearAllFilters?: () => void; // Callback to clear all filters in URL
  filterValueApi?: (field: string) => string | Promise<string[]>;
  // Sorting support
  currentSort?: { key: string; direction: 'asc' | 'desc' } | null; // Current sort state from URL
  onSortChange?: (sortKey: string, direction: 'asc' | 'desc') => void; // Callback to update URL
  // Actions
  actions?: React.ReactNode;
  // Expandable rows support
  expandable?: boolean;
  singleExpansion?: boolean; // If true, only one row can be expanded at a time
  renderExpandedContent?: (item: T, index?: number) => React.ReactNode;
  getExpandedRowClassName?: (item: T) => string;
  onRowExpand?: (itemId: string | number, isExpanded: boolean, item?: T) => void;
  // Data source
  data?: T[]; // Client-side data (optional, overrides server-side fetching)
  apiEndpoint?: string; // Server-side API endpoint (optional if data provided)
  currentPage?: number; // Required if using server-side
  onPageChange?: (page: number) => void; // Required if using server-side
}

export default function DataTable<T>({
  title,
  subtitle,
  columns,
  getItemId,
  getItemHref,
  emptyMessage = "No data found",
  className = "",
  headerClassName = "",
  rowClassName = "",
  selectable = false,
  selectedIds = new Set(),
  onSelectionChange,
  onSelectAll,
  onClearSelection,
  actions,
  expandable = false,
  singleExpansion = false,
  renderExpandedContent,
  getExpandedRowClassName,
  onRowExpand,
  filterable = true,
  currentFilters = {},
  onFilterChange,
  onClearAllFilters,
  currentSort = null,
  onSortChange,
  filterValueApi,
  // Data source
  data,
  apiEndpoint,
  currentPage = 1,
  onPageChange,
}: DataTableProps<T>) {
  // Data state
  const [serverData, setServerData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Use client data if provided, otherwise use server data
  const displayData = data || serverData;
  const isUsingClientData = !!data;
  
  // UI state
  const [expandedRows, setExpandedRows] = useState<Set<string | number>>(new Set());
  const [showFilterDropdown, setShowFilterDropdown] = useState<string | null>(null);
  const [filterSearchTerms, setFilterSearchTerms] = useState<Record<string, string>>({});

  // Data fetching - only fetch server data if no client data provided
  useEffect(() => {
    if (!data && apiEndpoint) {
      fetchServerData();
    }
  }, [data, apiEndpoint, currentSort, currentFilters, currentPage]);

  const fetchServerData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const searchParams = new URLSearchParams();
      
      // Add pagination
      searchParams.append('page', currentPage.toString());
      searchParams.append('limit', '50');
      
      // Add sorting
      if (currentSort) {
        searchParams.append('sortColumn', currentSort.key);
        searchParams.append('sortDirection', currentSort.direction);
      }
      
      // Add filters
      let filterIndex = 0;
      Object.entries(currentFilters).forEach((filterEntry) => {
        const [columnKey, filterValues] = filterEntry;
        if (filterValues.size > 0) {
          const value = Array.from(filterValues)[0];
          
          // Handle date specially as a direct query parameter
          if (columnKey === 'date') {
            searchParams.append('date', value);
          } else {
            // Standard filter format for other columns
            searchParams.append(`filters[${filterIndex}][column]`, columnKey);
            searchParams.append(`filters[${filterIndex}][value]`, value);
            searchParams.append(`filters[${filterIndex}][operator]`, 'eq');
            filterIndex++;
          }
        }
      });
      
      const response = await fetch(`${apiEndpoint}?${searchParams}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      
      setServerData(result.data || []);
      setTotalCount(result.total || 0);
      setTotalPages(result.totalPages || 1);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
      setServerData([]);
      setTotalCount(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  };

  
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
      const allIds = new Set(displayData.map(item => getItemId(item)));
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

  const toggleRowExpansion = (itemId: string | number, item?: T) => {
    const newExpanded = new Set(expandedRows);
    const wasExpanded = newExpanded.has(itemId);

    if (wasExpanded) {
      newExpanded.delete(itemId);
    } else {
      // If single expansion mode, clear all other expanded rows
      if (singleExpansion) {
        newExpanded.clear();
      }
      newExpanded.add(itemId);
    }
    setExpandedRows(newExpanded);

    // Call the callback if provided
    if (onRowExpand) {
      onRowExpand(itemId, !wasExpanded, item);
    }
  };

  const expandAllRows = () => {
    setExpandedRows(new Set(displayData.map(item => getItemId(item))));
  };

  const collapseAllRows = () => {
    setExpandedRows(new Set());
  };

  const handleSort = (column: Column<T>) => {
    if (column.sortable === false || !onSortChange) return;

    const sortKey = column.sortKey || column.key;

    let newDirection: 'asc' | 'desc' = 'asc';
    if (currentSort?.key === sortKey) {
      // Toggle direction if same column
      newDirection = currentSort.direction === 'asc' ? 'desc' : 'asc';
    }

    onSortChange(sortKey, newDirection);
  };

  // Get filter values for dropdown
  const getSortValue = (item: T, column: Column<T>): any => {
    const sortKey = column.sortKey || column.key;
    if (typeof item === 'object' && item !== null && sortKey in item) {
      return (item as any)[sortKey];
    }
    return '';
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

    // Skip API fetching for date column since it uses custom predefined options
    if (column.key === 'date') {
      return ['yesterday', 'today', 'tomorrow', 'last_7_days', 'next_7_days'];
    }

    if (!filterValueApi) {
      // Fallback to computing from current data
      const values = new Set<string>();
      displayData.forEach(item => {
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
      displayData.forEach(item => {
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
    if (!onFilterChange) return;

    const columnFilters = currentFilters[columnKey] || new Set<string>();

    if (columnFilters.has(value)) {
      // If clicking the same value, remove it (clear the filter for this column)
      onFilterChange(columnKey, null);
    } else {
      // Replace any existing value with the new one (single value per column)
      onFilterChange(columnKey, value);
    }
    setShowFilterDropdown(null); // Close the dropdown after selecting/clearing
  };

  const clearColumnFilter = (columnKey: string) => {
    if (onFilterChange) {
      onFilterChange(columnKey, null);
      setShowFilterDropdown(null); // Close the dropdown after clearing
    }
  };

  const clearAllFilters = () => {
    if (onClearAllFilters) {
      onClearAllFilters();
    }
  };

  const handleFilterSearchChange = (columnKey: string, searchTerm: string) => {
    setFilterSearchTerms(prev => ({
      ...prev,
      [columnKey]: searchTerm
    }));
  };

  // Show loading only for server-side data
  if (loading && !isUsingClientData) {
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

  if (error && !isUsingClientData) {
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
              {displayData.length > 1 && (
                <>
                  <button
                    onClick={expandAllRows}
                    disabled={expandedRows.size === displayData.length}
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
            {isUsingClientData ? displayData.length : totalCount} total
            {currentSort ? ' (sorted)' : ''}
            {Object.keys(currentFilters).length > 0 ? ` (${Object.keys(currentFilters).length} filters)` : ''}
          </span>
          {Object.keys(currentFilters).length > 0 && (
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
              checked={selectedIds.size === displayData.length && displayData.length > 0}
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
          const isSorted = currentSort?.key === sortKey;
          const isSortable = column.sortable !== false; // Defaults to true
          const hasFilter = currentFilters[column.key]?.size > 0;
          const isFilterable = filterable !== false && column.filterable !== false && column.key !== 'actions';

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
                        currentSort.direction === 'asc' ? '↑' : '↓'
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
                      title={hasFilter ? `Filtered (${currentFilters[column.key]?.size} selected)` : 'Filter'}
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
                          onClick={(e) => {
                            e.stopPropagation();
                            clearColumnFilter(column.key);
                          }}
                          className="text-xs text-red-400 hover:text-red-300 font-mono"
                          style={{ pointerEvents: 'auto' }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    {/* Hide search input for date column since it has predefined options */}
                    {column.key !== 'date' && (
                      <input
                        type="text"
                        placeholder="Search..."
                        value={filterSearchTerms[column.key] || ''}
                        onChange={(e) => handleFilterSearchChange(column.key, e.target.value)}
                        className="w-full px-2 py-1 bg-gray-700 border border-gray-600 text-white text-xs font-mono rounded focus:outline-none focus:border-blue-400"
                        onClick={(e) => e.stopPropagation()}
                        style={{ pointerEvents: 'auto' }}
                      />
                    )}
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {(() => {
                      // Custom date filter options for date column
                      if (column.key === 'date') {
                        const dateOptions = [
                          { value: 'yesterday', label: 'Yesterday' },
                          { value: 'today', label: 'Today' },
                          { value: 'tomorrow', label: 'Tomorrow' },
                          { value: 'last_7_days', label: 'Last 7 days' },
                          { value: 'next_7_days', label: 'Next 7 days' }
                        ];

                        return dateOptions.map((option) => {
                          const isSelected = currentFilters[column.key]?.has(option.value) ?? false;
                          return (
                            <label
                              key={option.value}
                              className="flex items-center gap-2 px-2 py-1 hover:bg-gray-700 cursor-pointer"
                              style={{ pointerEvents: 'auto' }}
                            >
                              <input
                                type="radio"
                                name={`filter-${column.key}`}
                                checked={isSelected}
                                onChange={() => toggleFilterValue(column.key, option.value)}
                                className="rounded-full border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-600"
                                style={{ pointerEvents: 'auto' }}
                              />
                              <span className="text-xs font-mono text-gray-300 truncate">
                                {option.label}
                              </span>
                            </label>
                          );
                        });
                      }

                      // Default behavior for other columns
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
                        const isSelected = currentFilters[column.key]?.has(value) ?? false;
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
        {displayData.length === 0 ? (
          <div className="py-4 border-b border-gray-600">
            <span className="text-gray-500 text-xs font-mono">{emptyMessage}</span>
          </div>
        ) : (
          displayData.map((item, index) => {
            const itemId = getItemId(item);
            const href = getItemHref?.(item);
            const isExpanded = expandedRows.has(itemId);

            const RowContent = (
              <div
                className={`grid ${expandable && selectable ? 'grid-cols-15' : expandable || selectable ? 'grid-cols-14' : 'grid-cols-13'} gap-1 py-1 border-b border-gray-600 text-xs font-mono ${rowClassName} ${expandable ? 'cursor-pointer hover:bg-gray-800' : ''} ${expandable && isExpanded ? 'bg-gray-900' : ''}`}
                onClick={expandable ? () => toggleRowExpansion(itemId, item) : undefined}
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
                      toggleRowExpansion(itemId, item);
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

      {/* Pagination Controls */}
      {!isUsingClientData && totalPages > 1 && (
        <div className="flex items-center justify-between py-2 border-gray-600">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange && onPageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              className="px-3 py-1 text-xs font-mono bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 text-white rounded transition-colors"
              style={{ pointerEvents: 'auto' }}
            >
              ← Previous
            </button>

            <span className="text-xs font-mono text-gray-400">
              Page {currentPage} of {totalPages}
            </span>

            <button
              onClick={() => onPageChange && onPageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="px-3 py-1 text-xs font-mono bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 text-white rounded transition-colors"
              style={{ pointerEvents: 'auto' }}
            >
              Next →
            </button>
          </div>

          <div className="flex items-center gap-1">
            {/* Page number buttons */}
            {(() => {
              const pages = [];
              const maxVisiblePages = 5;
              let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
              let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

              // Adjust start page if we're near the end
              if (endPage - startPage + 1 < maxVisiblePages) {
                startPage = Math.max(1, endPage - maxVisiblePages + 1);
              }

              for (let i = startPage; i <= endPage; i++) {
                pages.push(
                  <button
                    key={i}
                    onClick={() => onPageChange && onPageChange(i)}
                    className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                      i === currentPage
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                    }`}
                    style={{ pointerEvents: 'auto' }}
                  >
                    {i}
                  </button>
                );
              }
              return pages;
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
