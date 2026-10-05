import {
  getUniverseMasks, numbersToMask, maskToNumbers, evaluatePortfolio,
  buildHistoricalModel, historicalPortfolioScore,
} from './combinatorics.js';

// Scenario illustrativo: quote medie pubblicate, NON quote del prossimo concorso.
// Bonus Numerone CUMULATI con il premio base. Rendita e imposte sono escluse.
// Fonti verificate 2026-10-05:
// https://www.winforlife.it/quanto-si-vince-classico
// https://www.sisal.it/win-for-life-classico/quanto-si-vince
export const DEFAULT_SCENARIO = Object.freeze({
  base7: 200, base8: 1000, base9: 6000, base10: 1000000,
  bonus7: 1200, bonus8: 2000, bonus9: 50000,
});
const FULL_MASK = (1 << 20) - 1;
let popcounts;
function pcTable() {
  if (!popcounts) {
    popcounts = new Uint8Array(1 << 20);
    for (let i = 1; i < popcounts.length; i++) popcounts[i] = popcounts[i >> 1] + (i & 1);
  }
  return popcounts;
}
function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name}: valore intero tra ${min} e ${max}`);
  return value;
}
function fraction(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name}: valore tra 0 e 1`);
  return value;
}
export function normalizeScenario(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Scenario non valido');
  return Object.fromEntries(Object.entries(DEFAULT_SCENARIO).map(([key, def]) => [key,
    integer(input[key] === undefined ? def : Number(input[key]), 0, 100000000, key),
  ]));
}
function normalizePortfolio(tickets) {
  if (!Array.isArray(tickets)) throw new Error('Combinazioni non valide');
  integer(tickets.length, 1, 100, 'Numero combinazioni');
  const masks = new Set();
  return tickets.map((t) => {
    if (!Array.isArray(t?.numbers) || t.numbers.length !== 10) throw new Error('Servono 10 numeri distinti');
    const mask = numbersToMask(t.numbers);
    if (masks.has(mask)) throw new Error('Combinazioni principali duplicate');
    masks.add(mask);
    return { mask, numerone: integer(t.numerone, 1, 20, 'Numerone') };
  });
}
function unpack(portfolio) {
  return portfolio.map((t) => ({ numbers: maskToNumbers(t.mask), numerone: t.numerone }));
}
function validateMode(mode) {
  if (!['1e', '2e'].includes(mode)) throw new Error('Modalita non valida');
}

// Per ogni esito principale integriamo analiticamente tutti i 20 Numeroni.
// Un risultato vale per l'intero portfolio nello STESSO concorso.
function counters(portfolio, mode, scenario, outcomes) {
  const pc = pcTable();
  const costCents = portfolio.length * (mode === '1e' ? 100 : 200);
  const bonus = new Float64Array(21);
  const annuity = new Uint8Array(21);
  const basePrizes = [0, 0, 0, 0, 0, 0, 0, scenario.base7, scenario.base8, scenario.base9, scenario.base10];
  const extraPrizes = [0, 0, 0, 0, 0, 0, 0, scenario.bonus7, scenario.bonus8, scenario.bonus9, 0];
  const numeroni = [...new Set(portfolio.map((t) => t.numerone))];
  let prize = 0, recover = 0, profit = 0, rent = 0, totalCash = 0;
  for (const outcome of outcomes) {
    bonus.fill(0); annuity.fill(0);
    let base = 0, hasPrize = false;
    for (const ticket of portfolio) {
      const hits = pc[outcome & ticket.mask];
      const score = mode === '2e' ? Math.max(hits, 10 - hits) : hits;
      if (score < 7) continue;
      hasPrize = true;
      base += basePrizes[score];
      bonus[ticket.numerone] += extraPrizes[score];
      if (score === 10) annuity[ticket.numerone] = 1;
    }
    if (hasPrize) prize += 20;
    // Numeroni non scelti: nessun bonus, ma valgono il premio base.
    if (base >= costCents) recover += 20 - numeroni.length;
    if (base > costCents) profit += 20 - numeroni.length;
    totalCash += 20 * base;
    for (const n of numeroni) {
      const cash = base + bonus[n];
      if (cash >= costCents) recover++;
      if (cash > costCents) profit++;
      rent += annuity[n];
      totalCash += bonus[n];
    }
  }
  const size = outcomes.length * 20;
  return {
    costCents, outcomeCount: size, anyPrizeCount: prize, recoverCount: recover,
    profitCount: profit, annuityCount: rent,
    anyPrizeProbability: prize / size, recoverProbability: recover / size,
    profitProbability: profit / size, lossProbability: 1 - recover / size,
    breakEvenProbability: (recover - profit) / size,
    annuityProbability: rent / size, meanGrossCashCents: totalCash / size,
    meanGrossNetCents: totalCash / size - costCents,
    scenario, exactConditionalOnScenario: true,
    note: 'Calcolo esatto con quote ipotetiche fisse, al lordo. NON previsione del profitto reale. Rendita esclusa dagli incassi e calcolata separatamente.',
  };
}
export function evaluateFinancialScenario(tickets, mode = '2e', scenario = {}) {
  validateMode(mode);
  return counters(normalizePortfolio(tickets), mode, normalizeScenario(scenario), getUniverseMasks());
}
function rng(seed) {
  let x = (seed >>> 0) || 2463534242;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
}
function randomMask(rand) {
  const arr = Array.from({ length: 20 }, (_, i) => i + 1);
  for (let i = 19; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return numbersToMask(arr.slice(0, 10));
}
function keyMask(mask, mode, goal) {
  return mode === '2e' && goal === 'coverage' ? Math.min(mask, FULL_MASK ^ mask) : mask;
}
function randomPortfolio(count, rand, mode, goal) {
  const out = [], seen = new Set();
  const ns = Array.from({ length: 20 }, (_, i) => i + 1);
  for (let i = 19; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [ns[i], ns[j]] = [ns[j], ns[i]]; }
  while (out.length < count) {
    const mask = randomMask(rand), key = keyMask(mask, mode, goal);
    if (seen.has(key)) continue;
    seen.add(key); out.push({ mask, numerone: ns[out.length % 20] });
  }
  return out;
}
function mutate(portfolio, rand, mode, goal) {
  const index = Math.floor(rand() * portfolio.length);
  const current = portfolio[index];
  const next = portfolio.map((t) => ({ ...t }));
  if (goal !== 'coverage' && rand() < 0.25) {
    next[index].numerone = 1 + Math.floor(rand() * 20);
    return next;
  }
  const on = [], off = [];
  for (let i = 0; i < 20; i++) (current.mask & (1 << i) ? on : off).push(i);
  const mask = (current.mask ^ (1 << on[Math.floor(rand() * 10)])) | (1 << off[Math.floor(rand() * 10)]);
  if (portfolio.some((t, i) => i !== index && keyMask(t.mask, mode, goal) === keyMask(mask, mode, goal))) return null;
  next[index].mask = mask;
  return next;
}
function categoryCoverage(portfolio, mode, outcomes) {
  const pc = pcTable(); let count = 0;
  for (const outcome of outcomes) {
    for (const t of portfolio) {
      const hits = pc[outcome & t.mask];
      if (hits >= 7 || (mode === '2e' && hits <= 3)) { count++; break; }
    }
  }
  return count / outcomes.length;
}
function orderedValidDraws(draws) {
  const seen = new Set(), result = [];
  for (const d of draws || []) {
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.drawDate) || !/^\d{2}:\d{2}$/.test(d.drawTime)) continue;
      if (!Array.isArray(d.numbers) || d.numbers.length !== 10) continue;
      numbersToMask(d.numbers); integer(d.numerone, 1, 20, 'Numerone');
      const key = `${d.drawDate} ${d.drawTime}`;
      if (seen.has(key)) continue;
      seen.add(key); result.push(d);
    } catch { /* Dati invalidi non usati nello score. */ }
  }
  return result.sort((a, b) => `${a.drawDate} ${a.drawTime}`.localeCompare(`${b.drawDate} ${b.drawTime}`));
}
export function buildCombinedHistory(draws, window = 5000, recentShare = 0.5) {
  fraction(recentShare, 'Peso recente');
  const all = orderedValidDraws(draws);
  const size = window === 'all' ? all.length : integer(Number(window), 1, 100000, 'Finestra recente');
  const recent = all.slice(-size);
  const totalModel = buildHistoricalModel(all, { window: 'all' });
  const recentModel = buildHistoricalModel(recent, { window: 'all' });
  const mix = (a, b) => (1 - recentShare) * a + recentShare * b;
  const model = {
    analyzedDraws: all.length,
    numberScores: totalModel.numberScores.map((v, i) => mix(v, recentModel.numberScores[i])),
    pairScores: totalModel.pairScores.map((row, i) => row.map((v, j) => mix(v, recentModel.pairScores[i][j]))),
    numeroneScores: totalModel.numeroneScores.map((v, i) => mix(v, recentModel.numeroneScores[i])),
  };
  return { all, recent, model, totalModel, recentModel, recentShare };
}
function observed(portfolio, mode, draws) {
  const outcomes = Uint32Array.from(draws.map((d) => numbersToMask(d.numbers)));
  return { draws: draws.length, coveredPct: draws.length ? 100 * categoryCoverage(portfolio, mode, outcomes) : null,
    firstDate: draws[0]?.drawDate ?? null, lastDate: draws.at(-1)?.drawDate ?? null };
}
function historyReport(portfolio, mode, history) {
  const nums = unpack(portfolio).map((t) => t.numbers);
  return {
    all: observed(portfolio, mode, history.all), recent: observed(portfolio, mode, history.recent),
    totalScore: history.all.length ? historicalPortfolioScore(nums, history.totalModel) * 100 : null,
    recentScore: history.recent.length ? historicalPortfolioScore(nums, history.recentModel) * 100 : null,
    mixedScore: history.all.length ? historicalPortfolioScore(nums, history.model) * 100 : null,
    recentShare: history.recentShare,
    predictionValidated: false,
    note: 'Confronto retrospettivo descrittivo, sugli stessi dati eventualmente usati per scegliere il portfolio. NON backtest fuori campione e NON probabilita future.',
  };
}
export function analyzePortfolio({ portfolio, mode = '2e', scenario = {}, historyDraws = [], historyWindow = 5000, recentShare = 0.5 }) {
  validateMode(mode);
  const normalized = normalizePortfolio(portfolio);
  const history = buildCombinedHistory(historyDraws, historyWindow, recentShare);
  return { exact: evaluatePortfolio(portfolio.map((t) => t.numbers), mode),
    financial: evaluateFinancialScenario(portfolio, mode, scenario),
    historical: historyReport(normalized, mode, history),
  };
}

const PROFILES = {
  fast: { starts: 3, iterations: 180, sample: 1200, exactSteps: 6 },
  normal: { starts: 5, iterations: 400, sample: 3000, exactSteps: 12 },
  deep: { starts: 8, iterations: 800, sample: 5000, exactSteps: 24 },
};
export function optimizeLabPortfolio({ tickets = 5, mode = '2e', goal = 'coverage', strategy = 'coverage', quality = 'normal',
  scenario = {}, historyDraws = [], historyWindow = 5000, historicalWeight = 0.25,
  recentShare = 0.5, savedPortfolios = [], baseSeed = 42 } = {}) {
  integer(tickets, 1, 100, 'Numero combinazioni'); validateMode(mode);
  if (!['coverage', 'profit', 'recover'].includes(goal)) throw new Error('Obiettivo non valido');
  if (!['coverage', 'hybrid', 'historical'].includes(strategy)) throw new Error('Strategia non valida');
  if (strategy === 'historical' && goal !== 'coverage') throw new Error('Solo score storico non ottimizza un obiettivo economico');
  if (!Object.hasOwn(PROFILES, quality)) throw new Error('Qualita non valida');
  const prizes = normalizeScenario(scenario);
  const history = buildCombinedHistory(historyDraws, historyWindow, recentShare);
  if (strategy !== 'coverage' && history.all.length < 100) throw new Error('Importa almeno 100 estrazioni valide oppure usa Solo matematica');
  const weight = strategy === 'hybrid' ? fraction(historicalWeight, 'Peso storico') : 0;
  const profile = PROFILES[quality], universe = getUniverseMasks();
  const rand = rng(baseSeed);
  const sample = Uint32Array.from({ length: profile.sample }, () => universe[Math.floor(rand() * universe.length)]);
  const iterations = Math.max(60, Math.floor(profile.iterations * Math.min(1, 20 / tickets)));
  const hist = (p) => historicalPortfolioScore(unpack(p).map((t) => t.numbers), history.model);
  const metric = (p, outcomes) => {
    let probability;
    if (goal === 'coverage') probability = categoryCoverage(p, mode, outcomes);
    else { const f = counters(p, mode, prizes, outcomes); probability = goal === 'profit' ? f.profitProbability : f.recoverProbability; }
    const score = strategy === 'historical' ? hist(p) : strategy === 'hybrid' ? (1 - weight) * probability + weight * hist(p) : probability;
    return { score, probability };
  };
  let best = null;
  const runs = [], seen = new Set();
  let savedCompared = 0;
  const consider = (portfolio, source, seed, savedId = null) => {
    const key = portfolio.map((t) => `${t.mask}:${t.numerone}`).sort().join(',');
    if (seen.has(key)) return;
    seen.add(key);
    const exact = metric(portfolio, universe);
    if (!best || exact.score > best.score + 1e-12 || (Math.abs(exact.score - best.score) < 1e-12 && exact.probability > best.probability + 1e-12)) {
      best = { portfolio, ...exact, source, seed, savedId };
    }
  };
  const baseline = randomPortfolio(tickets, rand, mode, goal);
  consider(baseline, 'random-iniziale', baseSeed);
  // Rivalutazione con obiettivo e quote CORRENTI, non con vecchi score memorizzati.
  for (const saved of savedPortfolios) {
    if (saved.mode !== mode || saved.status === 'ARCHIVED' || saved.tickets?.length !== tickets) continue;
    try { const p = normalizePortfolio(saved.tickets); consider(p, 'portafoglio-salvato', saved.seed, saved.id); savedCompared++; }
    catch { /* Un portfolio salvato non valido non ferma tutta la ricerca. */ }
  }
  const savedBest = best;
  for (let run = 0; run < profile.starts; run++) {
    const seed = (baseSeed + Math.imul(run + 1, 0x9e3779b1)) >>> 0;
    const localRand = rng(seed);
    let current = run === 0 ? best.portfolio.map((t) => ({ ...t })) : randomPortfolio(tickets, localRand, mode, goal);
    let score = metric(current, sample).score;
    let accepted = 0;
    for (let i = 0; i < iterations; i++) {
      const candidate = mutate(current, localRand, mode, goal);
      if (!candidate) continue;
      const next = metric(candidate, sample).score;
      if (next >= score - 1e-12) { current = candidate; score = next; accepted++; }
    }
    consider(current, 'ricerca-multistart', seed);
    runs.push({ seed, acceptedMutations: accepted, sampleObjective: score });
  }
  let exactAccepted = 0;
  // Rifinitura limitata: ogni accettazione e verificata sull'universo COMPLETO.
  for (let i = 0; i < profile.exactSteps; i++) {
    const next = mutate(best.portfolio, rand, mode, goal);
    if (!next) continue;
    const before = best.score;
    consider(next, 'rifinitura-esatta', baseSeed);
    if (best.score > before + 1e-12) exactAccepted++;
  }
  const portfolio = unpack(best.portfolio);
  const analysis = analyzePortfolio({ portfolio, mode, scenario: prizes, historyDraws: history.all, historyWindow, recentShare });
  return {
    algorithm: 'lottery-lab-objectives-v4', globallyOptimalGuaranteed: false,
    portfolio, ...analysis, strategy, goal, quality, seed: best.seed, selectedSeed: best.seed, baseSeed,
    starts: profile.starts, iterationsPerStart: iterations, iterations: iterations * profile.starts,
    sampleSize: sample.length, exactRefinementAttempts: profile.exactSteps, exactAccepted,
    historicalWeight: weight, historicalScorePct: analysis.historical.mixedScore,
    objectiveScore: best.score, objectiveScorePct: 100 * best.score,
    source: best.source, retainedPortfolioId: best.savedId, savedCompared,
    savedComparisonScorePct: 100 * savedBest.score,
    history: { requestedWindow: historyWindow, analyzedDraws: history.all.length },
    baselineExact: evaluatePortfolio(unpack(baseline).map((t) => t.numbers), mode),
    baselineFinancial: counters(baseline, mode, prizes, universe),
    comparisonNote: 'Il riferimento casuale e UN solo portfolio, non una media di benchmark.',
    runs,
  };
}
