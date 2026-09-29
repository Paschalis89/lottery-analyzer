import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoveragePlan, evaluatePortfolio, getUniverseMasks, maskToNumbers, numbersToMask } from '../src/combinatorics.js';

test('universo 10 su 20 = 184756', () => {
  assert.equal(getUniverseMasks().length, 184756);
});

test('mask roundtrip', () => {
  const numbers = [1,2,3,4,5,6,7,8,9,10];
  assert.deepEqual(maskToNumbers(numbersToMask(numbers)), numbers);
});

test('coverage singola 1 euro esatta', () => {
  const result = evaluatePortfolio([[1,2,3,4,5,6,7,8,9,10]], '1e');
  assert.equal(result.covered, 16526);
  assert.ok(Math.abs(result.percentage - 8.944770399878758) < 1e-9);
  assert.equal(result.guaranteedHit, false);
});

test('coverage singola 2 euro simmetrica', () => {
  const result = evaluatePortfolio([[1,2,3,4,5,6,7,8,9,10]], '2e');
  assert.equal(result.covered, 33052);
  assert.ok(Math.abs(result.percentage - 17.889540799757516) < 1e-9);
});

test('coverage planner restituisce coverage esatta verificabile', () => {
  const plan = buildCoveragePlan({ minBudgetEuro: 2, maxBudgetEuro: 4, mode: '2e', seed: 7, maxPoints: 2, candidatesPerTicket: 20, sampleSize: 2000 });
  assert.equal(plan.rows.length, 2);
  assert.equal(plan.rows[0].tickets, 1);
  assert.equal(plan.rows[1].tickets, 2);
  assert.ok(plan.rows[1].coveragePct >= plan.rows[0].coveragePct);
});
