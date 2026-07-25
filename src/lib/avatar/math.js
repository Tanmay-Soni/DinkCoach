/**
 * Small numeric helpers used by the composite pipeline. Landmark geometry lives
 * in ../geometry.js; these are the plain array reducers that file does not carry.
 */

export function lerp(a, b, u) {
  return a + (b - a) * u;
}

export function median(values) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
