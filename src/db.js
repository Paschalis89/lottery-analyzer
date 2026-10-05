import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

function nowIso() {
  return new Date().toISOString();
}

function cents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function createDatabase(dbPath, { migrateLegacy = false } = {}) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sql = new DatabaseSync(dbPath);
  sql.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') {
    sql.exec('PRAGMA journal_mode = WAL;');
    sql.exec('PRAGMA synchronous = NORMAL;');
  }

  sql.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      display_name TEXT NOT NULL DEFAULT 'Profilo locale',
      initial_bankroll_cents INTEGER NOT NULL DEFAULT 0,
      monthly_budget_cents INTEGER NOT NULL DEFAULT 0,
      default_mode TEXT NOT NULL DEFAULT '2e' CHECK (default_mode IN ('1e','2e')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS draws (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contest INTEGER NOT NULL,
      draw_date TEXT NOT NULL,
      draw_time TEXT NOT NULL,
      numbers_json TEXT NOT NULL,
      numerone INTEGER NOT NULL,
      source_url TEXT,
      fetched_at TEXT NOT NULL,
      UNIQUE(draw_date, contest),
      UNIQUE(draw_date, draw_time)
    );

    CREATE INDEX IF NOT EXISTS idx_draws_date_time ON draws(draw_date, draw_time);

    CREATE TABLE IF NOT EXISTS scrape_days (
      draw_date TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      draws_count INTEGER NOT NULL DEFAULT 0,
      source_url TEXT,
      error TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS portfolios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      portfolio_type TEXT NOT NULL DEFAULT 'MONTHLY' CHECK (portfolio_type IN ('INITIAL','MONTHLY','CUSTOM')),
      period TEXT,
      mode TEXT NOT NULL CHECK (mode IN ('1e','2e')),
      ticket_cost_cents INTEGER NOT NULL,
      tickets_count INTEGER NOT NULL,
      seed INTEGER,
      iterations INTEGER,
      algorithm TEXT,
      coverage_count INTEGER NOT NULL,
      universe_size INTEGER NOT NULL DEFAULT 184756,
      coverage_pct REAL NOT NULL,
      baseline_pct REAL,
      guaranteed_hit INTEGER NOT NULL DEFAULT 0,
      planned_draws INTEGER NOT NULL DEFAULT 1,
      budget_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PLAYED','ARCHIVED')),
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS portfolio_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      numbers_json TEXT NOT NULL,
      numerone INTEGER NOT NULL,
      UNIQUE(portfolio_id, position)
    );

    CREATE TABLE IF NOT EXISTS plays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      play_batch TEXT NOT NULL,
      portfolio_id INTEGER REFERENCES portfolios(id) ON DELETE SET NULL,
      portfolio_ticket_id INTEGER REFERENCES portfolio_tickets(id) ON DELETE SET NULL,
      mode TEXT NOT NULL CHECK (mode IN ('1e','2e')),
      target_draw_date TEXT NOT NULL,
      target_draw_time TEXT NOT NULL,
      numbers_json TEXT NOT NULL,
      numerone INTEGER NOT NULL,
      cost_cents INTEGER NOT NULL,
      played_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SETTLED')),
      actual_draw_id INTEGER REFERENCES draws(id) ON DELETE SET NULL,
      hits INTEGER,
      numerone_hit INTEGER,
      category TEXT,
      payout_cents INTEGER NOT NULL DEFAULT 0,
      payout_confirmed INTEGER NOT NULL DEFAULT 0,
      notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_plays_target ON plays(target_draw_date, target_draw_time);
    CREATE INDEX IF NOT EXISTS idx_plays_month ON plays(target_draw_date);
  `);

  const tsProfile = nowIso();
  sql.prepare(`INSERT OR IGNORE INTO profile
    (id, display_name, initial_bankroll_cents, monthly_budget_cents, default_mode, created_at, updated_at)
    VALUES (1, 'Profilo locale', 0, 0, '2e', ?, ?)`
  ).run(tsProfile, tsProfile);

  function insertDraw(draw) {
    const result = sql.prepare(`
      INSERT OR IGNORE INTO draws
      (contest, draw_date, draw_time, numbers_json, numerone, source_url, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(draw.contest),
      draw.drawDate,
      draw.drawTime,
      JSON.stringify(draw.numbers),
      Number(draw.numerone),
      draw.sourceUrl || null,
      draw.fetchedAt || nowIso(),
    );
    return Number(result.changes || 0);
  }

  function addDraws(draws) {
    sql.exec('BEGIN');
    try {
      let added = 0;
      for (const draw of draws) added += insertDraw(draw);
      sql.exec('COMMIT');
      return added;
    } catch (error) {
      sql.exec('ROLLBACK');
      throw error;
    }
  }

  function rowToDraw(row) {
    if (!row) return null;
    return {
      id: row.id,
      contest: row.contest,
      drawDate: row.draw_date,
      drawTime: row.draw_time,
      numbers: parseJsonArray(row.numbers_json),
      numerone: row.numerone,
      sourceUrl: row.source_url,
      fetchedAt: row.fetched_at,
    };
  }

  function listDraws({ limit = 200, offset = 0, order = 'desc' } = {}) {
    const dir = order === 'asc' ? 'ASC' : 'DESC';
    return sql.prepare(`SELECT * FROM draws ORDER BY draw_date ${dir}, draw_time ${dir} LIMIT ? OFFSET ?`)
      .all(Number(limit), Number(offset)).map(rowToDraw);
  }

  function getAllDrawsAscending() {
    return sql.prepare('SELECT * FROM draws ORDER BY draw_date ASC, draw_time ASC').all().map(rowToDraw);
  }

  function getDrawCount() {
    return Number(sql.prepare('SELECT COUNT(*) AS c FROM draws').get().c);
  }

  function getLatestDraw() {
    return rowToDraw(sql.prepare('SELECT * FROM draws ORDER BY draw_date DESC, draw_time DESC LIMIT 1').get());
  }

  function getDrawByDateTime(drawDate, drawTime) {
    return rowToDraw(sql.prepare('SELECT * FROM draws WHERE draw_date = ? AND draw_time = ? LIMIT 1').get(drawDate, drawTime));
  }

  function getAnnualDrawSummary() {
    return sql.prepare(`
      SELECT substr(draw_date,1,4) AS year, COUNT(*) AS count,
             MIN(draw_date || ' ' || draw_time) AS first_draw,
             MAX(draw_date || ' ' || draw_time) AS last_draw
      FROM draws GROUP BY substr(draw_date,1,4) ORDER BY year
    `).all().map((r) => ({ ...r, count: Number(r.count) }));
  }

  function setScrapeDay(date, state) {
    sql.prepare(`
      INSERT INTO scrape_days(draw_date,status,draws_count,source_url,error,updated_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(draw_date) DO UPDATE SET
        status=excluded.status,
        draws_count=excluded.draws_count,
        source_url=excluded.source_url,
        error=excluded.error,
        updated_at=excluded.updated_at
    `).run(date, state.status, Number(state.drawsCount || 0), state.sourceUrl || null, state.error || null, nowIso());
  }

  function getScrapeDay(date) {
    return sql.prepare('SELECT * FROM scrape_days WHERE draw_date = ?').get(date) || null;
  }

  function getStorageInfo() {
    return {
      dbPath,
      drawCount: getDrawCount(),
      scrapedDays: Number(sql.prepare('SELECT COUNT(*) AS c FROM scrape_days').get().c),
      warningDays: Number(sql.prepare("SELECT COUNT(*) AS c FROM scrape_days WHERE status <> 'ok'").get().c),
    };
  }

  function getProfile() {
    const row = sql.prepare('SELECT * FROM profile WHERE id = 1').get();
    return {
      displayName: row.display_name,
      initialBankrollCents: row.initial_bankroll_cents,
      monthlyBudgetCents: row.monthly_budget_cents,
      defaultMode: row.default_mode,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function updateProfile(input) {
    const current = getProfile();
    const next = {
      displayName: String(input.displayName ?? current.displayName).trim().slice(0, 80) || 'Profilo locale',
      initialBankrollCents: cents(input.initialBankrollCents ?? current.initialBankrollCents),
      monthlyBudgetCents: cents(input.monthlyBudgetCents ?? current.monthlyBudgetCents),
      defaultMode: input.defaultMode === '1e' ? '1e' : '2e',
    };
    sql.prepare(`UPDATE profile SET display_name=?, initial_bankroll_cents=?, monthly_budget_cents=?, default_mode=?, updated_at=? WHERE id=1`)
      .run(next.displayName, next.initialBankrollCents, next.monthlyBudgetCents, next.defaultMode, nowIso());
    return getProfile();
  }

  function savePortfolio(input) {
    const ts = nowIso();
    const mode = input.mode === '1e' ? '1e' : '2e';
    const ticketCostCents = mode === '1e' ? 100 : 200;
    const tickets = Array.isArray(input.tickets) ? input.tickets : [];
    if (!tickets.length) throw new Error('Portfolio senza combinazioni');
    const coverageCount = Number(input.coverageCount || 0);
    const universeSize = Number(input.universeSize || 184756);
    const coveragePct = Number(input.coveragePct || (coverageCount / universeSize) * 100);
    const plannedDraws = Math.max(1, Math.min(10000, Number(input.plannedDraws || 1)));
    const budgetCents = ticketCostCents * tickets.length * plannedDraws;

    sql.exec('BEGIN');
    try {
      const result = sql.prepare(`
        INSERT INTO portfolios
        (name,portfolio_type,period,mode,ticket_cost_cents,tickets_count,seed,iterations,algorithm,
         coverage_count,universe_size,coverage_pct,baseline_pct,guaranteed_hit,planned_draws,budget_cents,status,notes,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        String(input.name || 'Portfolio').trim().slice(0, 100),
        ['INITIAL','MONTHLY','CUSTOM'].includes(input.portfolioType) ? input.portfolioType : 'MONTHLY',
        input.period || null,
        mode,
        ticketCostCents,
        tickets.length,
        Number.isFinite(Number(input.seed)) ? Number(input.seed) : null,
        Number.isFinite(Number(input.iterations)) ? Number(input.iterations) : null,
        input.algorithm || null,
        coverageCount,
        universeSize,
        coveragePct,
        Number.isFinite(Number(input.baselinePct)) ? Number(input.baselinePct) : null,
        coverageCount === universeSize ? 1 : 0,
        plannedDraws,
        budgetCents,
        input.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
        input.notes || null,
        ts,
        ts,
      );
      const portfolioId = Number(result.lastInsertRowid);
      const insertTicket = sql.prepare(`INSERT INTO portfolio_tickets(portfolio_id,position,numbers_json,numerone) VALUES(?,?,?,?)`);
      tickets.forEach((ticket, index) => {
        insertTicket.run(portfolioId, index + 1, JSON.stringify(ticket.numbers), Number(ticket.numerone));
      });
      sql.exec('COMMIT');
      return getPortfolio(portfolioId);
    } catch (error) {
      sql.exec('ROLLBACK');
      throw error;
    }
  }

  function getPortfolio(id) {
    const row = sql.prepare('SELECT * FROM portfolios WHERE id = ?').get(Number(id));
    if (!row) return null;
    const tickets = sql.prepare('SELECT * FROM portfolio_tickets WHERE portfolio_id = ? ORDER BY position').all(Number(id));
    return portfolioRow(row, tickets);
  }

  function portfolioRow(row, ticketRows = []) {
    return {
      id: row.id,
      name: row.name,
      portfolioType: row.portfolio_type,
      period: row.period,
      mode: row.mode,
      ticketCostCents: row.ticket_cost_cents,
      ticketsCount: row.tickets_count,
      seed: row.seed,
      iterations: row.iterations,
      algorithm: row.algorithm,
      coverageCount: row.coverage_count,
      universeSize: row.universe_size,
      coveragePct: row.coverage_pct,
      baselinePct: row.baseline_pct,
      guaranteedHit: Boolean(row.guaranteed_hit),
      plannedDraws: row.planned_draws,
      budgetCents: row.budget_cents,
      status: row.status,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      tickets: ticketRows.map((t) => ({
        id: t.id,
        position: t.position,
        numbers: parseJsonArray(t.numbers_json),
        numerone: t.numerone,
      })),
    };
  }

  function listPortfolios({ limit = 100, includeArchived = false } = {}) {
    const where = includeArchived ? '' : "WHERE status <> 'ARCHIVED'";
    const rows = sql.prepare(`SELECT * FROM portfolios ${where} ORDER BY created_at DESC LIMIT ?`).all(Number(limit));
    const ticketStmt = sql.prepare('SELECT * FROM portfolio_tickets WHERE portfolio_id = ? ORDER BY position');
    return rows.map((row) => portfolioRow(row, ticketStmt.all(row.id)));
  }

  // Eliminazione logica: le giocate contengono costi e premi che NON vanno rimossi.
  function archivePortfolio(id) {
    const p = getPortfolio(id);
    if (!p) return null;
    sql.prepare("UPDATE portfolios SET status='ARCHIVED',updated_at=? WHERE id=?").run(nowIso(), p.id);
    const linked = sql.prepare('SELECT COUNT(*) AS n FROM plays WHERE portfolio_id=?').get(p.id);
    return { portfolioId: p.id, archived: true, playsPreserved: Number(linked.n) };
  }

  function restorePortfolio(id) {
    const p = getPortfolio(id);
    if (!p) return null;
    if (p.status === 'ARCHIVED') {
      const linked = sql.prepare('SELECT COUNT(*) AS n FROM plays WHERE portfolio_id=?').get(p.id);
      sql.prepare('UPDATE portfolios SET status=?,updated_at=? WHERE id=?')
        .run(linked.n > 0 ? 'PLAYED' : 'DRAFT', nowIso(), p.id);
    }
    return getPortfolio(p.id);
  }

  function getPlayEvidence(recentLimit = 100) {
    const all = listPlays({ limit: -1 });
    const aggregate = (rows) => {
      let spent = 0, paid = 0, pending = 0, settled = 0, winning = 0;
      for (const p of rows) {
        spent += p.costCents;
        if (p.payoutConfirmed) paid += p.payoutCents;
        if (p.status === 'SETTLED') {
          settled++;
          if (p.category !== 'NO_PRIZE') winning++;
        }
        if (p.status !== 'SETTLED' || (p.category !== 'NO_PRIZE' && !p.payoutConfirmed)) pending++;
      }
      return { plays: rows.length, settled, winning, spentCents: spent,
        confirmedPayoutCents: paid, recordedNetCents: paid - spent,
        recordedRoiPct: spent ? (paid - spent) / spent * 100 : null,
        unresolvedPlays: pending, provisional: pending > 0 };
    };
    return { all: aggregate(all), recent: aggregate(all.slice(0, recentLimit)), recentLimit,
      note: 'Giocate personali, non estrazioni ufficiali. Saldo provvisorio se mancano risultati o premi. Nessun uso per recuperare perdite aumentando le puntate.' };
  }

  function registerPortfolioPlay(portfolioId, { targetDrawDate, targetDrawTime }) {
    const portfolio = getPortfolio(portfolioId);
    if (!portfolio) throw new Error('Portfolio non trovato');
    if (portfolio.status === 'ARCHIVED') throw new Error('Ripristina il portfolio prima di registrare altre giocate');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDrawDate || '')) throw new Error('Data estrazione non valida');
    if (!/^\d{2}:\d{2}$/.test(targetDrawTime || '')) throw new Error('Ora estrazione non valida');
    const batch = randomUUID();
    const ts = nowIso();
    sql.exec('BEGIN');
    try {
      const stmt = sql.prepare(`
        INSERT INTO plays
        (play_batch,portfolio_id,portfolio_ticket_id,mode,target_draw_date,target_draw_time,numbers_json,numerone,cost_cents,played_at,status)
        VALUES(?,?,?,?,?,?,?,?,?,?, 'OPEN')
      `);
      for (const ticket of portfolio.tickets) {
        stmt.run(batch, portfolio.id, ticket.id, portfolio.mode, targetDrawDate, targetDrawTime,
          JSON.stringify(ticket.numbers), ticket.numerone, portfolio.ticketCostCents, ts);
      }
      sql.prepare("UPDATE portfolios SET status='PLAYED', updated_at=? WHERE id=?").run(ts, portfolio.id);
      sql.exec('COMMIT');
      return { batch, playsCreated: portfolio.tickets.length, costCents: portfolio.ticketCostCents * portfolio.tickets.length };
    } catch (error) {
      sql.exec('ROLLBACK');
      throw error;
    }
  }

  function registerManualPlay(input) {
    const mode = input.mode === '1e' ? '1e' : '2e';
    const nums = Array.isArray(input.numbers) ? input.numbers.map(Number).sort((a,b) => a-b) : [];
    if (nums.length !== 10 || new Set(nums).size !== 10 || nums.some((n) => n < 1 || n > 20)) throw new Error('Servono 10 numeri distinti da 1 a 20');
    const numerone = Number(input.numerone);
    if (!Number.isInteger(numerone) || numerone < 1 || numerone > 20) throw new Error('Numerone non valido');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.targetDrawDate || '')) throw new Error('Data estrazione non valida');
    if (!/^\d{2}:\d{2}$/.test(input.targetDrawTime || '')) throw new Error('Ora estrazione non valida');
    const batch = randomUUID();
    const costCents = Number.isFinite(Number(input.costCents)) ? cents(input.costCents) : (mode === '1e' ? 100 : 200);
    const result = sql.prepare(`
      INSERT INTO plays(play_batch,mode,target_draw_date,target_draw_time,numbers_json,numerone,cost_cents,played_at,status,notes)
      VALUES(?,?,?,?,?,?,?,?, 'OPEN', ?)
    `).run(batch, mode, input.targetDrawDate, input.targetDrawTime, JSON.stringify(nums), numerone, costCents, nowIso(), input.notes || null);
    return getPlay(Number(result.lastInsertRowid));
  }

  function getPlay(id) {
    const row = sql.prepare(`
      SELECT p.*, pf.name AS portfolio_name FROM plays p
      LEFT JOIN portfolios pf ON pf.id = p.portfolio_id WHERE p.id=?
    `).get(Number(id));
    return row ? playRow(row) : null;
  }

  function playRow(row) {
    return {
      id: row.id,
      playBatch: row.play_batch,
      portfolioId: row.portfolio_id,
      portfolioName: row.portfolio_name || null,
      mode: row.mode,
      targetDrawDate: row.target_draw_date,
      targetDrawTime: row.target_draw_time,
      numbers: parseJsonArray(row.numbers_json),
      numerone: row.numerone,
      costCents: row.cost_cents,
      playedAt: row.played_at,
      status: row.status,
      actualDrawId: row.actual_draw_id,
      hits: row.hits,
      numeroneHit: row.numerone_hit === null ? null : Boolean(row.numerone_hit),
      category: row.category,
      payoutCents: row.payout_cents,
      payoutConfirmed: Boolean(row.payout_confirmed),
      notes: row.notes,
    };
  }

  function listPlays({ month = null, limit = 500 } = {}) {
    let rows;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      rows = sql.prepare(`
        SELECT p.*, pf.name AS portfolio_name FROM plays p
        LEFT JOIN portfolios pf ON pf.id=p.portfolio_id
        WHERE substr(p.target_draw_date,1,7)=?
        ORDER BY p.target_draw_date DESC,p.target_draw_time DESC,p.id DESC LIMIT ?
      `).all(month, Number(limit));
    } else {
      rows = sql.prepare(`
        SELECT p.*, pf.name AS portfolio_name FROM plays p
        LEFT JOIN portfolios pf ON pf.id=p.portfolio_id
        ORDER BY p.target_draw_date DESC,p.target_draw_time DESC,p.id DESC LIMIT ?
      `).all(Number(limit));
    }
    return rows.map(playRow);
  }

  function categoryFor(mode, hits, numeroneHit) {
    const n = numeroneHit ? '+N' : '';
    if (hits >= 7) return `${hits}${n}`;
    if (mode === '2e' && hits <= 3) return `${hits}${n}`;
    return 'NO_PRIZE';
  }

  function settleOpenPlays() {
    const open = sql.prepare("SELECT * FROM plays WHERE status='OPEN' ORDER BY id").all();
    const update = sql.prepare(`
      UPDATE plays SET status='SETTLED',actual_draw_id=?,hits=?,numerone_hit=?,category=? WHERE id=?
    `);
    let settled = 0;
    let stillOpen = 0;
    sql.exec('BEGIN');
    try {
      for (const play of open) {
        const draw = sql.prepare('SELECT * FROM draws WHERE draw_date=? AND draw_time=? LIMIT 1').get(play.target_draw_date, play.target_draw_time);
        if (!draw) {
          stillOpen += 1;
          continue;
        }
        const ticket = new Set(parseJsonArray(play.numbers_json));
        const drawn = parseJsonArray(draw.numbers_json);
        const hits = drawn.reduce((acc, n) => acc + (ticket.has(n) ? 1 : 0), 0);
        const numeroneHit = Number(play.numerone) === Number(draw.numerone);
        const category = categoryFor(play.mode, hits, numeroneHit);
        update.run(draw.id, hits, numeroneHit ? 1 : 0, category, play.id);
        settled += 1;
      }
      sql.exec('COMMIT');
    } catch (error) {
      sql.exec('ROLLBACK');
      throw error;
    }
    return { settled, stillOpen };
  }

  function updatePlayPayout(id, payoutCents, notes = undefined) {
    const existing = getPlay(id);
    if (!existing) throw new Error('Giocata non trovata');
    sql.prepare(`UPDATE plays SET payout_cents=?, payout_confirmed=1, notes=COALESCE(?,notes) WHERE id=?`)
      .run(cents(payoutCents), notes ?? null, Number(id));
    return getPlay(id);
  }

  function getPersonalSummary(month) {
    const selectedMonth = /^\d{4}-\d{2}$/.test(month || '') ? month : new Date().toISOString().slice(0,7);
    const profile = getProfile();
    const all = sql.prepare(`
      SELECT COUNT(*) AS plays, COALESCE(SUM(cost_cents),0) AS spent,
             COALESCE(SUM(payout_cents),0) AS payouts,
             SUM(CASE WHEN status='SETTLED' THEN 1 ELSE 0 END) AS settled,
             SUM(CASE WHEN status='SETTLED' AND category <> 'NO_PRIZE' THEN 1 ELSE 0 END) AS winning
      FROM plays
    `).get();
    const m = sql.prepare(`
      SELECT COUNT(*) AS plays, COALESCE(SUM(cost_cents),0) AS spent,
             COALESCE(SUM(payout_cents),0) AS payouts,
             SUM(CASE WHEN status='SETTLED' THEN 1 ELSE 0 END) AS settled,
             SUM(CASE WHEN status='SETTLED' AND category <> 'NO_PRIZE' THEN 1 ELSE 0 END) AS winning
      FROM plays WHERE substr(target_draw_date,1,7)=?
    `).get(selectedMonth);

    const normalize = (x) => ({
      plays: Number(x.plays || 0),
      spentCents: Number(x.spent || 0),
      payoutCents: Number(x.payouts || 0),
      netCents: Number(x.payouts || 0) - Number(x.spent || 0),
      settled: Number(x.settled || 0),
      winning: Number(x.winning || 0),
      roiPct: Number(x.spent || 0) ? ((Number(x.payouts || 0) - Number(x.spent || 0)) / Number(x.spent || 0)) * 100 : 0,
    });
    const total = normalize(all);
    const monthly = normalize(m);

    return {
      month: selectedMonth,
      profile,
      total,
      monthly,
      bankrollCents: profile.initialBankrollCents + total.netCents,
      monthlyRemainingCents: profile.monthlyBudgetCents - monthly.spentCents,
    };
  }

  function close() {
    sql.close();
  }

  if (migrateLegacy && dbPath !== ':memory:') {
    const migrated = sql.prepare("SELECT value FROM meta WHERE key='legacy_ndjson_imported'").get();
    const legacyFile = path.join(path.dirname(dbPath), 'draws.ndjson');
    if (!migrated && fs.existsSync(legacyFile)) {
      const lines = fs.readFileSync(legacyFile, 'utf8').split(/\r?\n/).filter(Boolean);
      let count = 0;
      for (const line of lines) {
        try { count += insertDraw(JSON.parse(line)); } catch { /* ignore malformed legacy row */ }
      }
      sql.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('legacy_ndjson_imported',?)").run(JSON.stringify({ at: nowIso(), count }));
    }
  }

  return {
    raw: sql,
    addDraws,
    listDraws,
    getAllDrawsAscending,
    getDrawCount,
    getLatestDraw,
    getDrawByDateTime,
    getAnnualDrawSummary,
    setScrapeDay,
    getScrapeDay,
    getStorageInfo,
    getProfile,
    updateProfile,
    savePortfolio,
    getPortfolio,
    listPortfolios,
    archivePortfolio,
    restorePortfolio,
    getPlayEvidence,
    registerPortfolioPlay,
    registerManualPlay,
    listPlays,
    settleOpenPlays,
    updatePlayPayout,
    getPersonalSummary,
    close,
  };
}

