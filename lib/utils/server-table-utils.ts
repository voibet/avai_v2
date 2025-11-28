import { executeQuery } from '../database/db-utils';


export type SortDirection = 'asc' | 'desc';
export type FilterOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in' | 'ilike';

export interface TableSort {
  column: string;
  direction: SortDirection;
}

export interface TableFilter {
  column: string;
  value: any;
  operator: FilterOperator;
}

export interface TableParams {
  page: number;
  limit: number;
  sort?: TableSort;
  filters: TableFilter[];
  search?: string;
  searchColumns?: string[]; // Columns to search in when using search term
}

export interface TableResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

/**
 * Parse table parameters from URL search params
 */
export function parseTableParams(searchParams: URLSearchParams): TableParams {
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.max(1, Math.min(1000, parseInt(searchParams.get('limit') || '50')));
  
  // Parse sorting - support both camelCase (sortColumn/sortDirection) and snake_case (sort_by/sort_direction)
  let sort: TableSort | undefined;
  const sortColumn = searchParams.get('sortColumn') || searchParams.get('sort_by');
  const sortDirection = (searchParams.get('sortDirection') || searchParams.get('sort_direction')) as SortDirection;
  if (sortColumn && (sortDirection === 'asc' || sortDirection === 'desc')) {
    sort = { column: sortColumn, direction: sortDirection };
  }
  
  // Parse filters
  const filters: TableFilter[] = [];
  let filterIndex = 0;
  while (true) {
    const column = searchParams.get(`filters[${filterIndex}][column]`);
    const value = searchParams.get(`filters[${filterIndex}][value]`);
    const operator = searchParams.get(`filters[${filterIndex}][operator]`) as FilterOperator;
    
    if (!column || value === null) break;
    
    filters.push({
      column: sanitizeColumnName(column),
      value: parseFilterValue(value),
      operator: operator || 'eq'
    });
    
    filterIndex++;
  }
  
  // Parse search
  const search = searchParams.get('search') || undefined;
  
  return {
    page,
    limit,
    sort: sort ? { ...sort, column: sanitizeColumnName(sort.column) } : undefined,
    filters,
    search
  };
}

/**
 * Build SQL query with filtering, sorting, and pagination
 */
export function buildTableQuery(
  baseQuery: string,
  params: TableParams,
  validColumns: Record<string, string> = {}, // Map of API column names to DB column names
  defaultSort?: TableSort
): { query: string; countQuery: string; queryParams: any[] } {
  const whereConditions: string[] = [];
  const queryParams: any[] = [];
  let paramIndex = 1;
  
  // Add filters to WHERE clause
  for (const filter of params.filters) {
    const dbColumn = validColumns[filter.column] || filter.column;
    const condition = buildFilterCondition(dbColumn, filter, paramIndex);
    if (condition) {
      whereConditions.push(condition.condition);
      queryParams.push(...condition.params);
      paramIndex += condition.params.length;
    }
  }
  
  // Add search to WHERE clause
  if (params.search && params.searchColumns) {
    const searchConditions = params.searchColumns.map(col => {
      const dbColumn = validColumns[col] || col;
      return `${dbColumn} ILIKE $${paramIndex}`;
    });
    
    if (searchConditions.length > 0) {
      whereConditions.push(`(${searchConditions.join(' OR ')})`);
      queryParams.push(`%${params.search}%`);
      paramIndex++;
    }
  }
  
  // Build WHERE clause
  const whereClause = whereConditions.length > 0 
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';
  
  // Build ORDER BY clause
  const sort = params.sort || defaultSort;
  const orderClause = sort 
    ? `ORDER BY ${validColumns[sort.column] || sort.column} ${sort.direction.toUpperCase()}`
    : '';
  
  // Build LIMIT and OFFSET
  const offset = (params.page - 1) * params.limit;
  const limitClause = `LIMIT ${params.limit} OFFSET ${offset}`;
  
  // Construct final queries
  const query = `${baseQuery} ${whereClause} ${orderClause} ${limitClause}`;
  const countQuery = `SELECT COUNT(*) as total FROM (${baseQuery}) as count_query ${whereClause}`;
  
  return {
    query: query.replace(/\s+/g, ' ').trim(),
    countQuery: countQuery.replace(/\s+/g, ' ').trim(),
    queryParams
  };
}

/**
 * Build filter condition for SQL WHERE clause
 */
function buildFilterCondition(
  column: string, 
  filter: TableFilter, 
  paramIndex: number
): { condition: string; params: any[] } | null {
  const { operator, value } = filter;
  
  if (value === null || value === undefined || value === '') {
    return null;
  }
  
  switch (operator) {
    case 'eq':
      // Special handling for league_name filter with "League Name (Country)" format
      if (column === 'league_name' && typeof value === 'string' && value.includes(' (') && value.endsWith(')')) {
        const lastParenIndex = value.lastIndexOf(' (');
        const leagueName = value.substring(0, lastParenIndex);
        const country = value.substring(lastParenIndex + 2, value.length - 1); // Remove " (" and ")"
        
        return {
          condition: `(${column} = $${paramIndex} AND league_country = $${paramIndex + 1})`,
          params: [leagueName, country]
        };
      }
      
      return {
        condition: `${column} = $${paramIndex}`,
        params: [value]
      };
      
    case 'ne':
      return {
        condition: `${column} != $${paramIndex}`,
        params: [value]
      };
      
    case 'gt':
      return {
        condition: `${column} > $${paramIndex}`,
        params: [value]
      };
      
    case 'gte':
      return {
        condition: `${column} >= $${paramIndex}`,
        params: [value]
      };
      
    case 'lt':
      return {
        condition: `${column} < $${paramIndex}`,
        params: [value]
      };
      
    case 'lte':
      return {
        condition: `${column} <= $${paramIndex}`,
        params: [value]
      };
      
    case 'like':
      return {
        condition: `${column} LIKE $${paramIndex}`,
        params: [`%${value}%`]
      };
      
    case 'ilike':
      return {
        condition: `${column} ILIKE $${paramIndex}`,
        params: [`%${value}%`]
      };
      
    case 'in':
      if (Array.isArray(value)) {
        const placeholders = value.map((_, i) => `$${paramIndex + i}`).join(', ');
        return {
          condition: `${column} IN (${placeholders})`,
          params: value
        };
      }
      break;
      
    default:
      console.warn(`Unknown filter operator: ${operator}`);
      return null;
  }
  
  return null;
}

/**
 * Execute a table query and return formatted results
 */
export async function executeTableQuery<T>(
  baseQuery: string,
  params: TableParams,
  validColumns: Record<string, string> = {},
  defaultSort?: TableSort
): Promise<TableResult<T>> {
  const { query, countQuery, queryParams } = buildTableQuery(
    baseQuery, 
    params, 
    validColumns, 
    defaultSort
  );
  
  try {
    // Execute count and data queries in parallel
    const [countResult, dataResult] = await Promise.all([
      executeQuery<{ total: string }>(countQuery, queryParams),
      executeQuery<T>(query, queryParams)
    ]);
    
    const total = parseInt(countResult.rows[0]?.total || '0');
    const totalPages = Math.ceil(total / params.limit);
    
    return {
      data: dataResult.rows,
      total,
      page: params.page,
      limit: params.limit,
      totalPages,
      hasNextPage: params.page < totalPages,
      hasPrevPage: params.page > 1
    };
    
  } catch (error) {
    console.error('Table query error:', error);
    console.error('Query:', query);
    console.error('Params:', queryParams);
    throw error;
  }
}

/**
 * Sanitize column name to prevent SQL injection
 */
function sanitizeColumnName(column: string): string {
  // Only allow alphanumeric characters, underscores, and dots
  return column.replace(/[^a-zA-Z0-9_.]/g, '');
}

/**
 * Parse filter value based on its type
 */
function parseFilterValue(value: string): any {
  // Try to parse as number
  if (/^\d+$/.test(value)) {
    return parseInt(value);
  }
  
  // Try to parse as float
  if (/^\d*\.\d+$/.test(value)) {
    return parseFloat(value);
  }
  
  // Try to parse as boolean
  if (value.toLowerCase() === 'true') {
    return true;
  }
  if (value.toLowerCase() === 'false') {
    return false;
  }
  
  // Return as string
  return value;
}
