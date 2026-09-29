import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/db.js';

test('draw identity usa data + concorso e non collide tra anni', () => {
  const db = createDatabase(':memory:');
  const base = { drawTime: '07:00', numbers: [1,2,3,4,5,6,7,8,9,10], numerone: 11, sourceUrl: 'x', fetchedAt: new Date().toISOString() };
  assert.equal(db.addDraws([{ ...base, contest: 1, drawDate: '2025-01-01' }]), 1);
  assert.equal(db.addDraws([{ ...base, contest: 1, drawDate: '2026-01-01' }]), 1);
  assert.equal(db.addDraws([{ ...base, contest: 1, drawDate: '2026-01-01' }]), 0);
  assert.equal(db.getDrawCount(), 2);
  db.close();
});

test('portfolio personale, giocata e settlement', () => {
  const db = createDatabase(':memory:');
  const draw = { contest: 99, drawDate: '2026-09-29', drawTime: '20:00', numbers: [1,2,3,4,5,6,7,8,9,10], numerone: 5, fetchedAt: new Date().toISOString() };
  db.addDraws([draw]);
  const p = db.savePortfolio({
    name: 'Test', portfolioType: 'MONTHLY', period: '2026-09', mode: '1e',
    tickets: [{ numbers: [1,2,3,4,5,6,7,8,9,10], numerone: 5 }],
    coverageCount: 16526, universeSize: 184756, coveragePct: 8.944770399878758, plannedDraws: 1,
  });
  const batch = db.registerPortfolioPlay(p.id, { targetDrawDate: '2026-09-29', targetDrawTime: '20:00' });
  assert.equal(batch.playsCreated, 1);
  const settled = db.settleOpenPlays();
  assert.equal(settled.settled, 1);
  const plays = db.listPlays({ month: '2026-09' });
  assert.equal(plays[0].hits, 10);
  assert.equal(plays[0].numeroneHit, true);
  assert.equal(plays[0].category, '10+N');
  db.close();
});
