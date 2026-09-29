import { database } from './database.js';

function combinations2(arr) {
  const pairs = [];
  for (let i = 0; i < arr.length; i += 1) {
    for (let j = i + 1; j < arr.length; j += 1) pairs.push([arr[i], arr[j]]);
  }
  return pairs;
}

function computeDelays(draws) {
  const state = Array.from({ length: 20 }, (_, i) => ({ number: i + 1, lastIndex: null, maxGap: 0, appearances: 0 }));
  draws.forEach((draw, index) => {
    for (const n of draw.numbers) {
      const s = state[n - 1];
      if (s.lastIndex !== null) s.maxGap = Math.max(s.maxGap, index - s.lastIndex - 1);
      s.lastIndex = index;
      s.appearances += 1;
    }
  });
  return state.map((s) => ({
    number: s.number,
    appearances: s.appearances,
    currentDelay: s.lastIndex === null ? draws.length : Math.max(0, draws.length - s.lastIndex - 1),
    maxDelay: s.maxGap,
  }));
}

export function buildStats({ window = 'all' } = {}) {
  const all = database.getAllDrawsAscending();
  const count = window === 'all' ? all.length : Math.min(all.length, Math.max(1, Number(window) || all.length));
  const draws = all.slice(all.length - count);
  const frequency = Array.from({ length: 20 }, (_, i) => ({ number: i + 1, count: 0 }));
  const numeroneFrequency = Array.from({ length: 20 }, (_, i) => ({ number: i + 1, count: 0 }));
  const pairCounts = new Map();

  for (const draw of draws) {
    for (const n of draw.numbers) frequency[n - 1].count += 1;
    numeroneFrequency[draw.numerone - 1].count += 1;
    for (const [a, b] of combinations2(draw.numbers)) {
      const key = `${a}-${b}`;
      pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    }
  }

  const total = draws.length;
  for (const item of frequency) {
    item.percentage = total ? (item.count / total) * 100 : 0;
    item.expectedCount = total / 2;
    const variance = total * 0.25;
    item.zScore = variance > 0 ? (item.count - item.expectedCount) / Math.sqrt(variance) : 0;
  }
  for (const item of numeroneFrequency) item.percentage = total ? (item.count / total) * 100 : 0;

  const topPairs = [...pairCounts.entries()]
    .map(([pair, pairCount]) => ({
      pair: pair.split('-').map(Number),
      count: pairCount,
      percentage: total ? (pairCount / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    totalStoredDraws: all.length,
    analyzedDraws: draws.length,
    window,
    firstDraw: draws[0] || null,
    lastDraw: draws.at(-1) || null,
    frequency,
    numeroneFrequency,
    delays: computeDelays(all),
    topPairs,
    annual: database.getAnnualDrawSummary(),
  };
}
