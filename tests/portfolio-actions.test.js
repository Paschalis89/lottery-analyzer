import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/db.js';
const nums = [1,2,3,4,5,6,7,8,9,10];
function portfolio(db) {
  return db.savePortfolio({ name: 'Da conservare', mode: '2e', portfolioType: 'CUSTOM',
    tickets: [{ numbers: nums, numerone: 4 }], coverageCount: 33052, universeSize: 184756, coveragePct: 17.88954 });
}
test('archiviazione reversibile senza perdere giocate, premi e collegamenti', () => {
  const db = createDatabase(':memory:');
  db.addDraws([{ contest: 1, drawDate: '2026-01-01', drawTime: '07:00', numbers: nums, numerone: 10 }]);
  const p = portfolio(db);
  db.registerPortfolioPlay(p.id, { targetDrawDate: '2026-01-01', targetDrawTime: '07:00' });
  db.settleOpenPlays();
  db.updatePlayPayout(db.listPlays()[0].id, 12000);
  const before = db.getPersonalSummary('2026-01');
  const evidence = db.getPlayEvidence();
  const result = db.archivePortfolio(p.id);
  assert.equal(result.playsPreserved, 1);
  assert.equal(db.listPortfolios().length, 0);
  assert.equal(db.listPortfolios({ includeArchived: true }).length, 1);
  assert.equal(db.listPlays()[0].portfolioName, p.name);
  assert.deepEqual(db.getPersonalSummary('2026-01'), before);
  assert.deepEqual(db.getPlayEvidence(), evidence);
  assert.throws(() => db.registerPortfolioPlay(p.id, { targetDrawDate: '2026-01-02', targetDrawTime: '07:00' }));
  assert.equal(db.archivePortfolio(p.id).archived, true);
  assert.equal(db.restorePortfolio(p.id).status, 'PLAYED');
  assert.equal(db.listPortfolios().length, 1);
  db.close();
});
test('giocate aperte e premi mancanti non sono scambiati per saldi definitivi', () => {
  const db = createDatabase(':memory:');
  const p = portfolio(db);
  db.registerPortfolioPlay(p.id, { targetDrawDate: '2026-01-01', targetDrawTime: '07:00' });
  let e = db.getPlayEvidence();
  assert.equal(e.all.provisional, true);
  assert.equal(e.all.confirmedPayoutCents, 0);
  assert.equal(e.all.recordedNetCents, -200);
  db.addDraws([{ contest: 1, drawDate: '2026-01-01', drawTime: '07:00', numbers: nums, numerone: 4 }]);
  db.settleOpenPlays();
  assert.equal(db.getPlayEvidence().all.provisional, true);
  db.updatePlayPayout(db.listPlays()[0].id, 0);
  e = db.getPlayEvidence();
  assert.equal(e.all.provisional, false);
  assert.equal(e.all.winning, 1);
  db.close();
});
test('nessun dato inventato per id inesistenti', () => {
  const db = createDatabase(':memory:');
  assert.equal(db.archivePortfolio(999), null);
  assert.equal(db.restorePortfolio(999), null);
  db.close();
});
