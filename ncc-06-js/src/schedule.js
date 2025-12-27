/**
 * Return a next-delay that applies deterministic jitter without exceeding the base interval.
 *
 * @param {number} baseMs - The nominal interval.
 * @param {number} jitterRatio - Fractional jitter (default 15%).
 * @returns {number} Delay in milliseconds (non-negative, never above baseMs).
 */
export function scheduleWithJitter(baseMs, jitterRatio = 0.15) {
  if (typeof baseMs !== 'number' || Number.isNaN(baseMs) || baseMs < 0) {
    throw new Error('baseMs must be a non-negative number');
  }
  if (typeof jitterRatio !== 'number' || Number.isNaN(jitterRatio) || jitterRatio < 0) {
    throw new Error('jitterRatio must be a non-negative number');
  }

  const jitterDelta = (Math.random() * 2 - 1) * jitterRatio * baseMs;
  const jittered = baseMs + jitterDelta;
  const clamped = Math.min(baseMs, Math.max(0, jittered));
  return Math.round(clamped);
}
