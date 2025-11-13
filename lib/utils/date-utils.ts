/**
 * Common date and time formatting utilities
 */

/**
 * Format a date for display with time
 * @param date Date to format
 * @param showSeconds Whether to include seconds (default: false)
 * @returns Formatted date string like "15.12 14:30" or "15.12 14:30:25"
 */
export function formatDateTime(date: Date | string | number, showSeconds = false): string {
  const d = new Date(date);
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');

  let timeStr = `${hours}:${minutes}`;
  if (showSeconds) {
    const seconds = d.getSeconds().toString().padStart(2, '0');
    timeStr += `:${seconds}`;
  }

  return `${day}.${month} ${timeStr}`;
}

/**
 * Format a date with full year and time (European format)
 * @param date Date to format
 * @returns Formatted date string like "15.12.2024 14.30"
 */
export function formatDateTimeFull(date: Date | string | number): string {
  const d = new Date(date);
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');

  return `${day}.${month}.${year} ${hours}.${minutes}`;
}

/**
 * Get start of day for a given date
 * @param date Date to get start of day for
 * @returns Date object set to start of day (00:00:00.000)
 */
export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get end of day for a given date
 * @param date Date to get end of day for
 * @returns Date object set to end of day (23:59:59.999)
 */
export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Check if two dates are on the same day
 * @param date1 First date
 * @param date2 Second date
 * @returns True if dates are on the same day
 */
export function isSameDay(date1: Date | string, date2: Date | string): boolean {
  const d1 = new Date(date1);
  const d2 = new Date(date2);

  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

/**
 * Format date range for filtering
 * @param from Start date
 * @param to End date
 * @returns Object with from and to dates
 */
export function parseDateRange(from?: string, to?: string): { from?: Date; to?: Date } {
  const result: { from?: Date; to?: Date } = {};

  if (from) {
    result.from = new Date(from);
  }

  if (to) {
    result.to = endOfDay(new Date(to));
  }

  return result;
}

/**
 * Format time duration in human readable format
 * @param milliseconds Duration in milliseconds
 * @returns Formatted duration string
 */
export function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

