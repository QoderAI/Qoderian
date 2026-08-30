/**
 * Qoderian - Date Utilities
 *
 * Date formatting helpers for system prompts.
 */

/** Returns today's date in readable and ISO format for the system prompt. */
export function getTodayDate(): string {
  const now = new Date();
  const readable = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const iso = now.toISOString().split('T')[0];
  return `${readable} (${iso})`;
}

/** Formats a duration in seconds as "1m 23s" or "45s". */
export function formatDurationMmSs(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0s';
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) {
    return `${secs}s`;
  }
  return `${mins}m ${secs}s`;
}

function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Formats a message timestamp as local "YYYY-MM-DD HH:mm".
 * Returns an empty string for unusable values so callers can skip rendering.
 */
export function formatMessageTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const day = `${date.getFullYear()}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}`;
  return `${day} ${padTwo(date.getHours())}:${padTwo(date.getMinutes())}`;
}
