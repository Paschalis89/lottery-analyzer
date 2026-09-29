let universeCache = null;
let popcountTable = null;

function ensurePopcountTable() {
  if (popcountTable) return popcountTable;
  popcountTable = new Uint8Array(1 << 20);
  for (let i = 1; i < popcountTable.length; i += 1) {
    popcountTable[i] = popcountTable[i >> 1] + (i & 1);
  }
  return popcountTable;
}

export function numbersToMask(numbers) {
  let mask = 0;
  for (const n of numbers) {
    if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error(`Numero non valido: ${n}`);
    mask |= 1 << (n - 1);
  }
  if (ensurePopcountTable()[mask] !== 10) throw new Error('Una combinazione deve contenere 10 numeri distinti');
  return mask >>> 0;
}

export function maskToNumbers(mask) {
  const result = [];
  for (let n = 1; n <= 20; n += 1) if (mask & (1 << (n - 1))) result.push(n);
  return result;
}

export function getUniverseMasks() {
  if (universeCache) return universeCache;
  const items = [];
  function rec(start, left, mask) {
    if (left === 0) {
      items.push(mask >>> 0);
      return;
    }
    for (let n = start; n <= 20 - left + 1; n += 1) rec(n + 1, left - 1, mask | (1 << (n - 1)));
  }
  rec(1, 10, 0);
  universeCache = Uint32Array.from(items);
  return universeCache;
}

function isCoveredHits(hits, mode) {
  return mode === '2e' ? (hits >= 7 || hits <= 3) : hits >= 7;
}

export function evaluatePortfolio(ticketNumbers, mode = '1e') {
  if (!['1e', '2e'].includes(mode)) throw new Error('mode deve essere 1e o 2e');
  const masks = ticketNumbers.map(numbersToMask);
  const unique = new Set(masks);
  if (unique.size !== masks.length) throw new Error('Il portfolio contiene combinazioni duplicate');
  const universe = getUniverseMasks();
  const pc = ensurePopcountTable();
  const bestScoreDistribution = Array(11).fill(0);
  let covered = 0;

  for (const outcome of universe) {
    let bestScore = -1;
    let winning = false;
    for (const ticket of masks) {
      const hits = pc[outcome & ticket];
      const score = mode === '2e' ? Math.max(hits, 10 - hits) : hits;
      if (score > bestScore) bestScore = score;
      if (isCoveredHits(hits, mode)) winning = true;
    }
    bestScoreDistribution[bestScore] += 1;
    if (winning) covered += 1;
  }

  const bandDistribution = [];
  for (let score = 0; score <= 10; score += 1) {
    const count = bestScoreDistribution[score];
    if (!count) continue;
    bandDistribution.push({
      score,
      label: mode === '2e' && score >= 5 ? `${score}/${10 - score}` : String(score),
      count,
      percentage: (count / universe.length) * 100,
    });
  }

  return {
    mode,
    tickets: ticketNumbers,
    universeSize: universe.length,
    covered,
    uncovered: universe.length - covered,
    probability: covered / universe.length,
    percentage: (covered / universe.length) * 100,
    guaranteedHit: covered === universe.length,
    bestScoreDistribution,
    bandDistribution,
  };
}

function xorshift32(seed) {
  let x = (seed || 123456789) >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
}

function randomTicketMask(rand) {
  const arr = Array.from({ length: 20 }, (_, i) => i + 1);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return numbersToMask(arr.slice(0, 10));
}

function sampleUniverse(maxSamples = 12000) {
  const universe = getUniverseMasks();
  if (universe.length <= maxSamples) return universe;
  const step = universe.length / maxSamples;
  const out = new Uint32Array(maxSamples);
  for (let i = 0; i < maxSamples; i += 1) out[i] = universe[Math.floor(i * step)];
  return out;
}

function sampleCoverage(masks, mode, sample) {
  const pc = ensurePopcountTable();
  let covered = 0;
  for (const outcome of sample) {
    let ok = false;
    for (const ticket of masks) {
      const hits = pc[outcome & ticket];
      if (isCoveredHits(hits, mode)) {
        ok = true;
        break;
      }
    }
    if (ok) covered += 1;
  }
  return covered;
}

function mutateTicket(mask, rand) {
  const selected = [];
  const unselected = [];
  for (let n = 1; n <= 20; n += 1) {
    if (mask & (1 << (n - 1))) selected.push(n);
    else unselected.push(n);
  }
  const remove = selected[Math.floor(rand() * selected.length)];
  const add = unselected[Math.floor(rand() * unselected.length)];
  return ((mask & ~(1 << (remove - 1))) | (1 << (add - 1))) >>> 0;
}

function numeroniFor(count) {
  const result = [];
  for (let i = 0; i < count; i += 1) {
    if (count <= 20) result.push(Math.floor((i * 20) / count) + 1);
    else result.push((i % 20) + 1);
  }
  return result;
}

export function optimizePortfolio({ tickets = 5, mode = '1e', seed = 42, iterations = 1200, sampleSize = 12000 } = {}) {
  if (!Number.isInteger(tickets) || tickets < 1 || tickets > 100) throw new Error('tickets deve essere tra 1 e 100');
  if (!['1e', '2e'].includes(mode)) throw new Error('mode deve essere 1e o 2e');

  const rand = xorshift32(Number(seed) || 42);
  const sample = sampleUniverse(Math.max(2000, Math.min(20000, Number(sampleSize) || 12000)));
  let portfolio = [];
  const seen = new Set();
  while (portfolio.length < tickets) {
    const mask = randomTicketMask(rand);
    if (!seen.has(mask)) {
      seen.add(mask);
      portfolio.push(mask);
    }
  }

  const baselinePortfolio = portfolio.slice();
  let bestScore = sampleCoverage(portfolio, mode, sample);
  let accepted = 0;

  for (let i = 0; i < iterations; i += 1) {
    const idx = Math.floor(rand() * portfolio.length);
    const candidateMask = mutateTicket(portfolio[idx], rand);
    if (portfolio.includes(candidateMask)) continue;
    const candidate = portfolio.slice();
    candidate[idx] = candidateMask;
    const score = sampleCoverage(candidate, mode, sample);
    if (score >= bestScore) {
      portfolio = candidate;
      bestScore = score;
      accepted += 1;
    }
  }

  const numbers = portfolio.map(maskToNumbers);
  const exact = evaluatePortfolio(numbers, mode);
  const baselineExact = evaluatePortfolio(baselinePortfolio.map(maskToNumbers), mode);
  const numeroni = numeroniFor(tickets);

  return {
    algorithm: 'sampled-hill-climb-v2',
    globallyOptimalGuaranteed: false,
    seed: Number(seed) || 42,
    iterations,
    acceptedMutations: accepted,
    sampleSize: sample.length,
    sampleCoverage: bestScore / sample.length,
    numeroniStrategy: 'diversified',
    portfolio: numbers.map((nums, i) => ({ numbers: nums, numerone: numeroni[i] })),
    exact,
    baselineExact,
  };
}

function evenlySpacedIntegers(min, max, maxPoints) {
  if (max < min) return [];
  const count = max - min + 1;
  if (count <= maxPoints) return Array.from({ length: count }, (_, i) => min + i);
  const set = new Set([min, max]);
  for (let i = 0; i < maxPoints; i += 1) set.add(Math.round(min + ((max - min) * i) / (maxPoints - 1)));
  return [...set].sort((a, b) => a - b);
}

function chooseBestAdditionalMask(portfolio, used, mode, sample, rand, candidateCount) {
  let bestMask = null;
  let bestScore = -1;
  for (let i = 0; i < candidateCount; i += 1) {
    let mask;
    let guard = 0;
    do {
      mask = randomTicketMask(rand);
      guard += 1;
    } while (used.has(mask) && guard < 100);
    if (used.has(mask)) continue;
    const score = sampleCoverage([...portfolio, mask], mode, sample);
    if (score > bestScore) {
      bestScore = score;
      bestMask = mask;
    }
  }
  if (bestMask === null) throw new Error('Impossibile generare una nuova combinazione candidata');
  return bestMask;
}

export function buildCoveragePlan({
  minBudgetEuro = 1,
  maxBudgetEuro = 20,
  mode = '1e',
  seed = 42,
  maxPoints = 15,
  candidatesPerTicket = 80,
  sampleSize = 5000,
} = {}) {
  if (!['1e', '2e'].includes(mode)) throw new Error('mode deve essere 1e o 2e');
  const ticketCostEuro = mode === '1e' ? 1 : 2;
  const minTickets = Math.max(1, Math.ceil(Number(minBudgetEuro) / ticketCostEuro));
  const maxTickets = Math.min(100, Math.floor(Number(maxBudgetEuro) / ticketCostEuro));
  if (maxTickets < minTickets) throw new Error('Range di spesa troppo basso per la modalità selezionata');
  const requestedCounts = evenlySpacedIntegers(minTickets, maxTickets, Math.max(2, Math.min(20, Number(maxPoints) || 15)));
  const requested = new Set(requestedCounts);

  const rand = xorshift32(Number(seed) || 42);
  const sample = sampleUniverse(Math.max(2000, Math.min(10000, Number(sampleSize) || 5000)));
  const portfolio = [];
  const used = new Set();
  const rows = [];

  for (let count = 1; count <= maxTickets; count += 1) {
    const best = chooseBestAdditionalMask(
      portfolio,
      used,
      mode,
      sample,
      rand,
      Math.max(20, Math.min(200, Number(candidatesPerTicket) || 80)),
    );
    portfolio.push(best);
    used.add(best);

    if (requested.has(count)) {
      const exact = evaluatePortfolio(portfolio.map(maskToNumbers), mode);
      rows.push({
        tickets: count,
        costEuro: count * ticketCostEuro,
        coveragePct: exact.percentage,
        covered: exact.covered,
        uncovered: exact.uncovered,
        guaranteedHit: exact.guaranteedHit,
        portfolio: portfolio.map(maskToNumbers),
      });
    }
  }

  return {
    mode,
    ticketCostEuro,
    algorithm: 'sequential-greedy-sampled-v1',
    globallyOptimalGuaranteed: false,
    note: 'Una riga al 100% garantisce copertura per quel portfolio specifico. Una riga sotto il 100% non dimostra che non esista un portfolio migliore.',
    rows,
  };
}

export function monthlyCoverageProjection(probabilityPerDraw, draws) {
  const p = Math.max(0, Math.min(1, Number(probabilityPerDraw) || 0));
  const n = Math.max(0, Math.floor(Number(draws) || 0));
  return {
    draws: n,
    expectedCoveredDraws: n * p,
    probabilityAtLeastOne: n ? 1 - ((1 - p) ** n) : 0,
  };
}
