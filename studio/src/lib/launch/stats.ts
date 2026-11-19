// The little statistics the promotion rules need: the regularized incomplete gamma function (for a
// Gamma posterior's CDF) and its inverse by bisection. Numerical Recipes' series and continued
// fraction, accurate to ~1e-10 for the shapes and ranges Launch sees.

function logGamma(x: number): number {
  // Lanczos approximation (g = 7, n = 9).
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** P(a, x): the regularized lower incomplete gamma function. */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 500; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return Math.min(1, sum * Math.exp(-x + a * Math.log(x) - logGamma(a)));
  }
  // Continued fraction for Q(a, x) (Lentz's method).
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-14) break;
  }
  return Math.max(0, 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h);
}

/** CDF of Gamma(shape, rate) at x. */
export const gammaCdf = (x: number, shape: number, rate: number) => gammaP(shape, rate * x);

/** The p-quantile of Gamma(shape, rate), by bisection. */
export function gammaQuantile(p: number, shape: number, rate: number): number {
  let lo = 0;
  let hi = Math.max(1, (shape + 10 * Math.sqrt(shape) + 10) / rate);
  while (gammaCdf(hi, shape, rate) < p) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (gammaCdf(mid, shape, rate) < p) lo = mid; else hi = mid;
    if (hi - lo < 1e-12 * hi) break;
  }
  return (lo + hi) / 2;
}
