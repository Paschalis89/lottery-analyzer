import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFinancialScenario, buildCombinedHistory, optimizeLabPortfolio, normalizeScenario } from '../src/portfolio-lab.js';
import { getUniverseMasks, numbersToMask } from '../src/combinatorics.js';

const one = [{ numbers: [1,2,3,4,5,6,7,8,9,10], numerone: 4 }];
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test('singola giocata: coverage e rendita esatte, modalità 1e e 2e', () => {
  const a = evaluateFinancialScenario(one, '1e');
  const b = evaluateFinancialScenario(one, '2e');
  assert.equal(a.outcomeCount, 3695120);
  assert.equal(a.anyPrizeCount, 16526 * 20);
  assert.equal(b.anyPrizeCount, 33052 * 20);
  assert.equal(a.annuityCount, 1);
  assert.equal(b.annuityCount, 2);
  close(b.recoverProbability, b.anyPrizeProbability);
  close(a.recoverProbability, a.anyPrizeProbability);
});

test('quote + Numerone cumulative: il premio 7+N supera la base di 2 euro', () => {
  const f = evaluateFinancialScenario(one, '2e');
  // Profitto: ogni 8/2, 9/1, 10/0; piu ogni 7/3 CON Numerone.
  const expected = (2 * (2025 + 100 + 1) * 20 + 2 * 14400) / 3695120;
  close(f.profitProbability, expected);
  close(f.profitProbability + f.lossProbability + f.breakEvenProbability, 1);
});

test('numerone uguale o diverso con complementari: corretta unione della rendita', () => {
  const second = { numbers: [11,12,13,14,15,16,17,18,19,20], numerone: 4 };
  const same = evaluateFinancialScenario([...one, second], '2e');
  const diff = evaluateFinancialScenario([...one, { ...second, numerone: 7 }], '2e');
  assert.equal(same.annuityCount, 2);
  assert.equal(diff.annuityCount, 4);
  close(same.anyPrizeProbability, diff.anyPrizeProbability);
});

test('scenario a quote nulle: categoria premiata non equivale a incasso', () => {
  const scenario = Object.fromEntries(Object.keys(normalizeScenario()).map((k) => [k, 0]));
  const f = evaluateFinancialScenario(one, '2e', scenario);
  assert.ok(f.anyPrizeProbability > 0);
  assert.equal(f.meanGrossCashCents, 0);
  assert.equal(f.profitProbability, 0);
  assert.equal(f.recoverProbability, 0);
});

test('incasso medio del modello additivo indipendente da sovrapposizione', () => {
  const a = evaluateFinancialScenario(one, '2e');
  const b = evaluateFinancialScenario([...one, { numbers: [2,3,4,5,6,7,8,9,10,11], numerone: 17 }], '2e');
  close(b.meanGrossCashCents, a.meanGrossCashCents * 2);
});

test('verifica indipendente brute force 184756 x 20 con portfolio a Numeroni ripetuti', () => {
  const tickets = [...one, { numbers: [1,3,5,7,9,11,13,15,17,19], numerone: 4 },
    { numbers: [2,4,6,8,10,12,14,16,18,20], numerone: 17 }];
  const f = evaluateFinancialScenario(tickets, '2e');
  const masks = tickets.map((t) => numbersToMask(t.numbers));
  const pop = (n) => { let count = 0; while (n) { n &= n-1; count++; } return count; };
  let any = 0, profit = 0, recover = 0, rent = 0, cashSum = 0;
  const bases = { 7: 200, 8: 1000, 9: 6000, 10: 1000000 };
  const bonus = { 7: 1200, 8: 2000, 9: 50000, 10: 0 };
  for (const u of getUniverseMasks()) {
    const scores = masks.map((m) => { const h = pop(m & u); return Math.max(h, 10 - h); });
    for (let n = 1; n <= 20; n++) {
      let cash = 0, won = false, hasRent = false;
      scores.forEach((score, i) => {
        if (score < 7) return;
        won = true;
        cash += bases[score] + (tickets[i].numerone === n ? bonus[score] : 0);
        if (score === 10 && tickets[i].numerone === n) hasRent = true;
      });
      any += Number(won); rent += Number(hasRent); cashSum += cash;
      recover += Number(cash >= 600); profit += Number(cash > 600);
    }
  }
  assert.equal(f.anyPrizeCount, any);
  assert.equal(f.profitCount, profit);
  assert.equal(f.recoverCount, recover);
  assert.equal(f.annuityCount, rent);
  close(f.meanGrossCashCents, cashSum / f.outcomeCount);
});

test('storico ordinato, deduplicato e finestra recente distinta dal totale', () => {
  const a = { drawDate: '2026-01-01', drawTime: '07:00', ...one[0] };
  const b = { ...a, drawDate: '2026-01-02' };
  const result = buildCombinedHistory([b, a, b, { ...a, numbers: [1] }], 1, 0.5);
  assert.equal(result.all.length, 2);
  assert.equal(result.recent.length, 1);
  assert.equal(result.recent[0].drawDate, '2026-01-02');
});

test('validazione quote e combinazioni non ammette valori errati', () => {
  assert.throws(() => normalizeScenario({ base7: -1 }));
  assert.throws(() => normalizeScenario({ bonus8: 1.4 }));
  assert.throws(() => evaluateFinancialScenario([...one, ...one], '2e'));
  assert.throws(() => evaluateFinancialScenario(one, 'bad'));
  assert.throws(() => optimizeLabPortfolio({ strategy: 'hybrid', historyDraws: [] }));
});

test('multistart ripetibile, confronto esatto con un portfolio salvato', () => {
  const first = optimizeLabPortfolio({ tickets: 3, mode: '2e', quality: 'fast', baseSeed: 123 });
  const repeat = optimizeLabPortfolio({ tickets: 3, mode: '2e', quality: 'fast', baseSeed: 123 });
  assert.deepEqual(first.portfolio, repeat.portfolio);
  const next = optimizeLabPortfolio({ tickets: 3, mode: '2e', quality: 'fast', baseSeed: 789,
    savedPortfolios: [{ id: 9, mode: '2e', status: 'DRAFT', tickets: first.portfolio }] });
  assert.equal(next.savedCompared, 1);
  assert.ok(next.exact.probability >= first.exact.probability);
});

test('obiettivo economico usa il confronto esatto condizionato alle quote', () => {
  const first = optimizeLabPortfolio({ tickets: 3, goal: 'profit', mode: '2e', quality: 'fast', baseSeed: 123 });
  close(first.objectiveScore, first.financial.profitProbability);
  assert.ok(first.objectiveScore >= first.baselineFinancial.profitProbability);
  assert.equal(first.historical.predictionValidated, false);
});
