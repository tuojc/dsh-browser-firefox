/** Concurrent-edit-safe restoration after a rejected prompt submission. */

export function restoreSubmittedText(current: string, submitted: string): string {
  return current === '' ? submitted : current
}

export function restoreSubmittedImages<T>(current: T[], submitted: T[]): T[] {
  return current.length === 0 ? submitted : current
}
