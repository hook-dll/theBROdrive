/**
 * Keeps the display awake while the game is the visible document.
 *
 * Browsers release screen wake locks when a tab becomes hidden, so reacquire the
 * lock whenever the player returns. Failure is non-fatal: the browser or operating
 * system may reject the request because of policy, battery state, or API support.
 */
export function installScreenWakeLock(): void {
  if (!('wakeLock' in navigator)) {
    console.warn('screen wake lock is not supported by this browser');
    return;
  }

  let sentinel: WakeLockSentinel | null = null;
  let requestPending = false;

  const request = async (): Promise<void> => {
    if (
      document.visibilityState !== 'visible'
      || requestPending
      || (sentinel !== null && !sentinel.released)
    ) {
      return;
    }

    requestPending = true;
    try {
      const acquired = await navigator.wakeLock.request('screen');
      if (document.visibilityState !== 'visible') {
        await acquired.release();
        return;
      }

      sentinel = acquired;
      acquired.addEventListener('release', () => {
        if (sentinel === acquired) sentinel = null;
      });
    } catch (error) {
      console.warn('screen wake lock request failed', error);
    } finally {
      requestPending = false;
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void request();
  });
  void request();
}
