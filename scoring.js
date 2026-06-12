'use strict';

const crypto = require('crypto');

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function seededUnit(seedHex, offset) {
  const slice = seedHex.slice(offset, offset + 8).padEnd(8, '0');
  return parseInt(slice, 16) / 0xffffffff;
}

function seededRange(seedHex, offset, min, max) {
  return min + seededUnit(seedHex, offset) * (max - min);
}

const GIG_SIGNAL_POLICY = {
  minFarePerTrip: 35,
  maxFarePerTrip: 650,
  maxTripsPerMonth: 520, // ~20 trips/day over 26 working days
  minSyntheticMonthlyEarnings: 15000,
  maxSyntheticMonthlyEarnings: 80000,
};

const SYNTHETIC_GIG_ARCHETYPES = [
  {
    name: 'thin_starter',
    weight: 0.18,
    tenure: [2, 5],
    monthlyTrips: [90, 150],
    fare: [95, 135],
    completion: [80, 88],
    rating: [3.9, 4.35],
  },
  {
    name: 'part_time_regular',
    weight: 0.28,
    tenure: [4, 12],
    monthlyTrips: [140, 230],
    fare: [110, 160],
    completion: [86, 93],
    rating: [4.15, 4.6],
  },
  {
    name: 'full_time_solid',
    weight: 0.34,
    tenure: [8, 24],
    monthlyTrips: [220, 360],
    fare: [125, 190],
    completion: [90, 96],
    rating: [4.35, 4.8],
  },
  {
    name: 'top_operator',
    weight: 0.20,
    tenure: [18, 36],
    monthlyTrips: [330, 500],
    fare: [145, 225],
    completion: [94, 99],
    rating: [4.6, 4.95],
  },
];

function pickSyntheticArchetype(seedHex) {
  const selector = seededUnit(seedHex, 0);
  let cumulative = 0;
  for (const archetype of SYNTHETIC_GIG_ARCHETYPES) {
    cumulative += archetype.weight;
    if (selector <= cumulative) return archetype;
  }
  return SYNTHETIC_GIG_ARCHETYPES[SYNTHETIC_GIG_ARCHETYPES.length - 1];
}

function deriveSyntheticGigProfile(seedValue, source) {
  const h = sha256Hex(`${source}|${seedValue}`);
  const archetype = pickSyntheticArchetype(h);
  const tenure = Math.round(seededRange(h, 8, archetype.tenure[0], archetype.tenure[1]));
  const monthlyTrips = Math.round(seededRange(h, 16, archetype.monthlyTrips[0], archetype.monthlyTrips[1]));
  const rupeesPerTrip = seededRange(h, 24, archetype.fare[0], archetype.fare[1]);
  const completionRate = Math.round(seededRange(h, 32, archetype.completion[0], archetype.completion[1]));
  const rating = Number(seededRange(h, 40, archetype.rating[0], archetype.rating[1]).toFixed(2));
  const earningsNoise = seededRange(h, 48, 0.92, 1.08);
  const monthlyEarnings = Math.round((monthlyTrips * rupeesPerTrip * earningsNoise) / 500) * 500;

  return normalizeGigSignals({
    trips: monthlyTrips * tenure,
    rating,
    earnings: monthlyEarnings,
    tenure,
    completionRate,
    weeklyEarnings: Math.round(monthlyEarnings / 4),
    monthlyTrips,
    rupeesPerTrip: Number(rupeesPerTrip.toFixed(2)),
    syntheticProfile: archetype.name,
    source,
  });
}

function normalizeGigSignals(input) {
  const issues = [];
  const trips = Math.max(0, Math.round(Number(input.trips || 0)));
  let tenure = Math.max(1, Math.round(Number(input.tenure || 1)));
  let earnings = Math.max(0, Math.round(Number(input.earnings || 0)));
  let completionRate = Math.max(0, Math.min(100, Math.round(Number(input.completionRate || 0))));
  let rating = Math.max(0, Math.min(5, Number(input.rating || 0)));

  const minTenureForVolume = Math.max(1, Math.ceil(trips / GIG_SIGNAL_POLICY.maxTripsPerMonth));
  if (tenure < minTenureForVolume) {
    issues.push(`tenure_raised_for_trip_volume:${tenure}->${minTenureForVolume}`);
    tenure = minTenureForVolume;
  }

  const monthlyTrips = trips / Math.max(tenure, 1);
  const minEarnings = Math.round(monthlyTrips * GIG_SIGNAL_POLICY.minFarePerTrip);
  const maxEarnings = Math.round(monthlyTrips * GIG_SIGNAL_POLICY.maxFarePerTrip);
  if (earnings > 0 && earnings < minEarnings) {
    issues.push(`earnings_raised_to_min_fare:${earnings}->${minEarnings}`);
    earnings = minEarnings;
  }
  if (earnings > maxEarnings) {
    issues.push(`earnings_capped_to_max_fare:${earnings}->${maxEarnings}`);
    earnings = maxEarnings;
  }
  if (input.source !== 'reclaim_proof') {
    earnings = Math.max(
      GIG_SIGNAL_POLICY.minSyntheticMonthlyEarnings,
      Math.min(earnings, GIG_SIGNAL_POLICY.maxSyntheticMonthlyEarnings)
    );
  }

  if (completionRate >= 95 && rating > 0 && rating < 4.2) {
    issues.push(`rating_raised_for_high_completion:${rating}->4.2`);
    rating = 4.2;
  }

  return {
    ...input,
    trips,
    rating: Number(rating.toFixed(2)),
    earnings,
    tenure,
    completionRate,
    weeklyEarnings: input.weeklyEarnings || Math.round(earnings / 4),
    monthlyTrips: Math.round(monthlyTrips),
    rupeesPerTrip: Number((earnings / Math.max(monthlyTrips, 1)).toFixed(2)),
    plausibilityIssues: issues,
  };
}

function deriveAddressSeedSignals(address) {
  return deriveSyntheticGigProfile(address, 'address_seed');
}

function deriveOnchainSignals(onchain) {
  const tierMultipliers = { 3: 1.5, 2: 1.0, 1: 0.5 };
  const m = tierMultipliers[onchain.tier] || 0.5;
  const estimatedEarnings = onchain.creditLimit > 0
    ? Math.round(onchain.creditLimit / m)
    : onchain.riderCount * 280;

  return normalizeGigSignals({
    trips: onchain.riderCount,
    rating: onchain.riderRating,
    earnings: onchain.monthlyEarnings > 0 ? onchain.monthlyEarnings : estimatedEarnings,
    tenure: onchain.tenureMonths > 0 ? onchain.tenureMonths : Math.max(1, Math.round(onchain.riderCount / 100)),
    completionRate: onchain.completionRate > 0
      ? onchain.completionRate
      : Math.min(99, Math.round(85 + (onchain.riderRating - 4.0) * 20)),
    source: onchain.source || 'onchain_derived',
  });
}

function bucketFor(value, thresholds) {
  if (value < thresholds[0]) return 1;
  if (value < thresholds[1]) return 2;
  if (value < thresholds[2]) return 3;
  return 4;
}

function scoreRecordFromSignals(signals) {
  const flags = signals.plausibilityIssues || [];
  let plausibilityFlags = 0;
  if (flags.some((f) => f.startsWith('tenure_raised'))) plausibilityFlags |= 1;
  if (flags.some((f) => f.startsWith('earnings_raised'))) plausibilityFlags |= 2;
  if (flags.some((f) => f.startsWith('earnings_capped'))) plausibilityFlags |= 4;
  if (flags.some((f) => f.startsWith('rating_raised'))) plausibilityFlags |= 8;

  return {
    incomeBucket: bucketFor(signals.earnings, [20000, 35000, 50000]),
    tenureBucket: bucketFor(signals.tenure, [6, 12, 24]),
    completionBucket: bucketFor(signals.completionRate, [85, 92, 97]),
    ratingBucket: bucketFor(signals.rating, [4.0, 4.5, 4.8]),
    source: signals.source === 'reclaim_proof' ? 'reclaim' : 'fallback',
    plausibilityFlags,
    monthlyEarnings: signals.earnings,
    tenureMonths: signals.tenure,
    completionRate: Math.round(signals.completionRate * 100),
  };
}

function applyStoredScore(onchain, computed) {
  if (!onchain.score || onchain.score <= 0) {
    return computed;
  }
  const tier = tierLabelFromBlueScore(onchain.score);
  const config = BLUE_TIER_CONFIG[tier] || BLUE_TIER_CONFIG['Blue Basic'];
  return {
    ...computed,
    score: onchain.score,
    tier,
    contractTier: onchain.tier > 0 ? onchain.tier : config.contractTier,
    creditLimit: onchain.creditLimit > 0 ? onchain.creditLimit : computed.creditLimit,
    apr: config.apr,
  };
}

function computeDashboardScore(onchain, signals, history = null) {
  const hasStoredScore = onchain.score && onchain.score > 0;
  const computed = computeBlueScore(signals, hasStoredScore ? null : history);
  return applyStoredScore(onchain, computed);
}

// ---------------------------------------------------------------------------
// Unified Blue Score — single pipeline from signals → score → tier → credit limit.
// Replaces the old binary-AND calculateCreditTier(). Weighted continuous formula
// so every marginal improvement moves the score, not just hard threshold jumps.
// ---------------------------------------------------------------------------

// Sigmoid normalization — diminishing returns at extremes, realistic score distribution.
// sig(x, mid, k): returns ~0.5 when x == mid, approaches 1 as x >> mid, 0 as x << mid.
function sig(x, mid, k) {
  return 1 / (1 + Math.exp(-k * (x - mid)));
}

const BLUE_SCORE_THRESHOLDS = {
  plus: 530,
  prime: 700,
  max: 900,
};

const BLUE_TIER_CONFIG = {
  'Blue Prime': { contractTier: 3, multiplier: 1.2, cap: 100000, apr: '10–12', underwritingApr: 0.12 },
  'Blue Plus': { contractTier: 2, multiplier: 0.7, cap: 50000, apr: '13–15', underwritingApr: 0.15 },
  'Blue Basic': { contractTier: 1, multiplier: 0.35, cap: 18000, apr: '16–18', underwritingApr: 0.18 },
};

function tierLabelFromBlueScore(score) {
  if (score >= BLUE_SCORE_THRESHOLDS.prime) return 'Blue Prime';
  if (score >= BLUE_SCORE_THRESHOLDS.plus) return 'Blue Plus';
  return 'Blue Basic';
}

function nextTierForLabel(tier) {
  if (tier === 'Blue Basic') return { label: 'Blue Plus', threshold: BLUE_SCORE_THRESHOLDS.plus };
  if (tier === 'Blue Plus') return { label: 'Blue Prime', threshold: BLUE_SCORE_THRESHOLDS.prime };
  return { label: null, threshold: BLUE_SCORE_THRESHOLDS.max };
}

function creditLimitForTier(tier, earnings) {
  const config = BLUE_TIER_CONFIG[tier] || BLUE_TIER_CONFIG['Blue Basic'];
  const monthlyEarnings = Math.max(0, Number(earnings || 0));
  const incomeLimit = monthlyEarnings * config.multiplier;
  if (incomeLimit < 1000) return 0;

  const maxAffordableEmi = monthlyEarnings * 0.40;
  const monthlyRate = config.underwritingApr / 12;
  const months = 12;
  const dtiLimit = monthlyRate > 0
    ? maxAffordableEmi * ((1 - Math.pow(1 + monthlyRate, -months)) / monthlyRate)
    : maxAffordableEmi * months;

  const finalLimit = Math.min(incomeLimit, dtiLimit, config.cap);
  if (finalLimit < 5000) return 0;
  return Math.floor(finalLimit / 1000) * 1000;
}

function computeBlueScore(signals, history = null) {
  const { trips, rating, earnings, completionRate } = signals;

  // ACRE history upgrades tenure if on-platform longer than proof tenure.
  const tenure = (history?.acreMonths > 0)
    ? Math.max(signals.tenure, history.acreMonths)
    : signals.tenure;

  // ── Sigmoid normalizations ───────────────────────────────────────────────
  // Each centered at a "solid average worker" value — meaningful non-linearity.
  //
  //   nEarnings:   0.09 @ ₹10k  | 0.40 @ ₹25k  | 0.50 @ ₹30k  | 0.77 @ ₹45k  | 0.88 @ ₹60k
  //   nTenure:     0.15 @ 1 mo  | 0.40 @ 5 mo  | 0.50 @ 8 mo  | 0.73 @ 12 mo | 0.92 @ 24 mo
  //   nRating:     0.23 @ 4.0   | 0.40 @ 4.2   | 0.50 @ 4.3   | 0.69 @ 4.5   | 0.88 @ 4.8
  //   nTrips:      0.11 @ 100   | 0.35 @ 500   | 0.50 @ 800   | 0.65 @ 1200  | 0.97 @ 2500
  //   nCompletion: 0.06 @ 75%   | 0.14 @ 80%   | 0.50 @ 87%   | 0.78 @ 92%   | 0.93 @ 97%
  const nEarnings = sig(earnings, 30000, 0.000080);
  const nTenure = sig(tenure, 8, 0.25);
  const nRating = sig(rating, 4.3, 4.00);
  const nTrips = sig(trips, 800, 0.003);
  const nCompletion = sig(completionRate, 87, 0.30);

  // ── Penalty multiplier ───────────────────────────────────────────────────
  // Poor signals actively pull the score down (not just contribute less).
  let penalty = 1.0;
  if (completionRate < 75) penalty *= 0.82;
  else if (completionRate < 80) penalty *= 0.90;
  else if (completionRate < 85) penalty *= 0.95;
  if (rating < 3.8) penalty *= 0.85;
  else if (rating < 4.0) penalty *= 0.92;
  if (earnings < 12000) penalty *= 0.90;

  // ── Weighted composite (penalty applied to whole block) ──────────────────
  const rawScore = penalty * (
    nEarnings * 0.30 +
    nTenure * 0.25 +
    nRating * 0.20 +
    nTrips * 0.15 +
    nCompletion * 0.10
  );

  // ── Excellence bonuses (flat points for top-decile performance) ──────────
  let bonusPts = 0;
  if (rating >= 4.8) bonusPts += 10;
  else if (rating >= 4.6) bonusPts += 5;
  if (completionRate >= 97) bonusPts += 10;
  else if (completionRate >= 93) bonusPts += 5;
  if (tenure >= 24) bonusPts += 8;
  else if (tenure >= 18) bonusPts += 4;

  // Returning ACRE user — on-chain proof of longitudinal consistency.
  const reputationBonus = history?.returning ? 20 : 0;

  // ── Thin-file caps ───────────────────────────────────────────────────────
  // Prevent inflated scores for workers without enough history to trust.
  let basePts = 300 + rawScore * 600;
  if (tenure < 2 && earnings < 15000) basePts = Math.min(basePts, 430);
  else if (tenure < 2) basePts = Math.min(basePts, 510);

  const score = Math.min(900, Math.round(basePts + bonusPts + reputationBonus));

  // ── Tier thresholds ──────────────────────────────────────────────────────
  // 300–529: Blue Basic  — thin-file / starter, micro-loans only
  // 530–699: Blue Plus   — established worker, competitive personal loans
  // 700–900: Blue Prime  — elite operator, best available terms
  const blueLabel = tierLabelFromBlueScore(score);
  const tierConfig = BLUE_TIER_CONFIG[blueLabel];
  const contractTier = tierConfig.contractTier;

  // ── Credit limit: income-indexed with DTI guardrails and no tier floors ──
  const creditLimit = creditLimitForTier(blueLabel, earnings);
  const apr = tierConfig.apr;

  const reason =
    blueLabel === 'Blue Prime' ? 'Elite operator — consistent high-volume earnings with strong platform reputation' :
      blueLabel === 'Blue Plus' ? 'Established worker — solid income history and reliable platform record' :
        'Growing profile — building credit history through consistent platform work';

  return {
    score,
    tier: blueLabel,
    contractTier,
    creditLimit,
    apr,
    reason,
    breakdown: {
      earnings: { value: earnings, normalized: nEarnings, weight: 0.30, contribution: Math.round(nEarnings * 0.30 * 600 * penalty) },
      tenure: { value: tenure, normalized: nTenure, weight: 0.25, contribution: Math.round(nTenure * 0.25 * 600 * penalty) },
      rating: { value: rating, normalized: nRating, weight: 0.20, contribution: Math.round(nRating * 0.20 * 600 * penalty) },
      activity: { value: trips, normalized: nTrips, weight: 0.15, contribution: Math.round(nTrips * 0.15 * 600 * penalty) },
      reliability: { value: completionRate, normalized: nCompletion, weight: 0.10, contribution: Math.round(nCompletion * 0.10 * 600 * penalty) },
    },
    _meta: { penalty: Math.round(penalty * 100) / 100, bonusPts, reputationBonus },
  };
}

module.exports = {
  BLUE_SCORE_THRESHOLDS,
  computeBlueScore,
  computeDashboardScore,
  creditLimitForTier,
  deriveAddressSeedSignals,
  deriveOnchainSignals,
  deriveSyntheticGigProfile,
  nextTierForLabel,
  normalizeGigSignals,
  scoreRecordFromSignals,
};
