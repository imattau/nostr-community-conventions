function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Generate an expected `k` token for NCC-02/NCC-05 pinning.
 */
export function generateExpectedK({ prefix = 'TESTKEY', label = 'ncc06', suffix } = {}) {
  const resolvedSuffix = suffix ?? randomSuffix();
  return `${prefix}:${label}-${resolvedSuffix}`;
}

/**
 * Validate the basic formatting of a `k` token.
 */
export function validateExpectedKFormat(k) {
  return typeof k === 'string' && /^[A-Z0-9_-]+:[^\s]+$/.test(k);
}
