import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThrottle } from '../../src/content/throttle.js';

describe('throttle pemindaian', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tetap memanggil selama penjadwalan berulang (debounce akan diam)', () => {
    const run = vi.fn();
    const throttle = createThrottle(40, run);

    // Pemindaian yang di-restart setiap gerakan (debounce) tidak akan pernah jalan di sini:
    // setiap jadwal baru membatalkan yang sebelumnya. Throttle tetap jalan ~1x per 40 ms.
    for (let elapsed = 0; elapsed < 300; elapsed += 30) {
      throttle.schedule();
      vi.advanceTimersByTime(30);
    }
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(5);

    // Setelah penjadwalan berhenti, tidak ada pemanggilan tambahan yang menumpuk.
    const afterBurst = run.mock.calls.length;
    vi.advanceTimersByTime(400);
    expect(run.mock.calls.length).toBe(afterBurst);
  });

  it('tidak menjalankan lebih dari sekali per interval', () => {
    const run = vi.fn();
    const throttle = createThrottle(40, run);

    throttle.schedule();
    throttle.schedule();
    throttle.schedule();
    vi.advanceTimersByTime(39);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);

    throttle.schedule();
    vi.advanceTimersByTime(40);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('memakai keadaan terbaru karena `run` dieksekusi saat timer berbunyi', () => {
    let latest = 'awal';
    const seen: string[] = [];
    const throttle = createThrottle(40, () => {
      seen.push(latest);
    });

    throttle.schedule();
    latest = 'kata-kedua';
    throttle.schedule();
    latest = 'kata-ketiga';
    vi.advanceTimersByTime(40);

    expect(seen).toEqual(['kata-ketiga']);
  });

  it('cancel membatalkan pemanggilan yang menunggu', () => {
    const run = vi.fn();
    const throttle = createThrottle(40, run);

    throttle.schedule();
    throttle.cancel();
    vi.advanceTimersByTime(200);
    expect(run).not.toHaveBeenCalled();

    // Setelah dibatalkan, jadwal berikutnya tetap berjalan.
    throttle.schedule();
    vi.advanceTimersByTime(40);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
