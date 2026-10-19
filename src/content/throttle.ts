/**
 * Throttle trailing-edge untuk jalur pemindaian.
 *
 * Aturan yang dijaga helper ini: paling banyak satu pemanggilan per interval, memakai
 * keadaan terbaru saat dipanggil, dan **tidak** di-restart ketika `schedule()` dipanggil
 * berulang. Perbedaan ini bukan detail: debounce (timer di-restart setiap gerakan) membuat
 * popup tidak pernah muncul selama kursor masih menyapu kata — terukur 0–3 dari 15 kata
 * tersorot, sedangkan throttle 14–15 dari 15 (`docs/mvp-audit.md` §4.30). Hachidori memakai
 * pola yang sama (`content.js`: "at most one scan per hoverDelayMs, always at the pointer's
 * latest position").
 */

export interface Throttle {
  /** Minta pemanggilan; diabaikan bila sudah ada yang menunggu. */
  schedule(): void;
  /** Batalkan pemanggilan yang menunggu. */
  cancel(): void;
}

export function createThrottle(intervalMs: number, run: () => void): Throttle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(): void {
      if (timer !== null) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        run();
      }, intervalMs);
    },
    cancel(): void {
      if (timer === null) {
        return;
      }
      clearTimeout(timer);
      timer = null;
    },
  };
}
