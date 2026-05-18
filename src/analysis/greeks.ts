export type OptionType = "CE" | "PE";

export type BsGreeks = {
  iv: number; // implied volatility (annualized, decimal)
  delta: number;
  gamma: number;
  thetaPerDay: number;
  vega: number;
  price: number;
};

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Abramowitz-Stegun erf approximation
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const ax = Math.abs(x);
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return sign * y;
}

function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function bsPrice(params: { S: number; K: number; r: number; T: number; sigma: number; type: OptionType }): number {
  const { S, K, r, T, sigma, type } = params;
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(sigma > 0)) return NaN;
  const volSqrtT = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / volSqrtT;
  const d2 = d1 - volSqrtT;

  if (type === "CE") {
    return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  }
  return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

function bsGreeksFromSigma(params: {
  S: number;
  K: number;
  r: number;
  T: number;
  sigma: number;
  type: OptionType;
}): Omit<BsGreeks, "iv"> {
  const { S, K, r, T, sigma, type } = params;
  const volSqrtT = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / volSqrtT;
  const d2 = d1 - volSqrtT;

  const price = bsPrice({ S, K, r, T, sigma, type });
  const pdf = normPdf(d1);

  const delta = type === "CE" ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf / (S * volSqrtT);

  const thetaAnnual =
    type === "CE"
      ? (-S * pdf * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * normCdf(d2)
      : (-S * pdf * sigma) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * normCdf(-d2);

  const thetaPerDay = thetaAnnual / 365;
  const vega = S * pdf * Math.sqrt(T);

  return { price, delta, gamma, thetaPerDay, vega };
}

export function impliedVolAndGreeks(params: {
  S: number;
  K: number;
  r: number;
  T: number;
  type: OptionType;
  marketPrice: number;
}): BsGreeks | null {
  const { S, K, r, T, type, marketPrice } = params;
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(marketPrice > 0)) return null;

  const intrinsic = type === "CE" ? Math.max(0, S - K) : Math.max(0, K - S);
  const upperBound = type === "CE" ? S : K * Math.exp(-r * T);
  if (marketPrice < intrinsic * 0.999) return null;
  if (marketPrice > upperBound * 1.001) return null;

  let lo = 1e-6;
  let hi = 5;

  // Ensure bracket
  const priceLo = bsPrice({ S, K, r, T, sigma: lo, type });
  const priceHi = bsPrice({ S, K, r, T, sigma: hi, type });
  if (!Number.isFinite(priceLo) || !Number.isFinite(priceHi)) return null;
  if (marketPrice < priceLo) return null;
  if (marketPrice > priceHi) return null;

  let mid = 0.2;
  for (let i = 0; i < 70; i++) {
    mid = (lo + hi) / 2;
    const p = bsPrice({ S, K, r, T, sigma: mid, type });
    if (!Number.isFinite(p)) return null;
    if (p > marketPrice) hi = mid;
    else lo = mid;
  }

  const g = bsGreeksFromSigma({ S, K, r, T, sigma: mid, type });
  return { iv: mid, ...g };
}
