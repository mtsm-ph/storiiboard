/** "2026-11-02 14:05" in local time: how backups are named and how times read in Recent. */
export function localDateTime(at: Date): string {
  if (Number.isNaN(at.getTime())) return '';
  const two = (n: number) => String(n).padStart(2, '0');
  return `${String(at.getFullYear())}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
}
