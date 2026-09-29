import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { database } from './database.js';
import { scrapeRange } from './scraper.js';
import { buildStats } from './stats.js';
import { buildCoveragePlan, evaluatePortfolio, monthlyCoverageProjection, optimizePortfolio } from './combinatorics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
const port = Number(process.env.PORT || 8080);

let scrapeJob = {
  running: false,
  startedAt: null,
  finishedAt: null,
  request: null,
  progress: null,
  result: null,
  error: null,
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2_000_000) throw new Error('Request body troppo grande');
  }
  return body.trim() ? JSON.parse(body) : {};
}

function mime(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function serveStatic(urlPath, res) {
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const fullPath = path.resolve(publicDir, relative);
  if (!fullPath.startsWith(publicDir) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) return false;
  const body = fs.readFileSync(fullPath);
  res.writeHead(200, { 'content-type': mime(fullPath), 'content-length': body.length });
  res.end(body);
  return true;
}

function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value); }
function validMonth(value) { return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value); }

function portfolioPayloadFromBody(body) {
  if (!Array.isArray(body.tickets) || !body.tickets.length) throw new Error('tickets deve contenere almeno una combinazione');
  const ticketNumbers = body.tickets.map((t) => Array.isArray(t) ? t : t.numbers);
  const mode = body.mode === '1e' ? '1e' : '2e';
  const exact = evaluatePortfolio(ticketNumbers, mode);
  const normalizedTickets = body.tickets.map((ticket, index) => {
    const numbers = Array.isArray(ticket) ? ticket : ticket.numbers;
    const suppliedN = Number(Array.isArray(ticket) ? NaN : ticket.numerone);
    const numerone = Number.isInteger(suppliedN) && suppliedN >= 1 && suppliedN <= 20
      ? suppliedN
      : (Math.floor((index * 20) / body.tickets.length) + 1);
    return { numbers, numerone };
  });
  return { exact, mode, normalizedTickets };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'winforlife-classico-analyzer',
        version: '0.2.0',
        drawCount: database.getDrawCount(),
        latestDraw: database.getLatestDraw(),
        annualDraws: database.getAnnualDrawSummary(),
        storage: database.getStorageInfo(),
        now: new Date().toISOString(),
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/profile') return sendJson(res, 200, database.getProfile());

    if (req.method === 'PUT' && url.pathname === '/api/profile') {
      const body = await readJson(req);
      return sendJson(res, 200, database.updateProfile(body));
    }

    if (req.method === 'GET' && url.pathname === '/api/dashboard') {
      const month = validMonth(url.searchParams.get('month')) ? url.searchParams.get('month') : new Date().toISOString().slice(0, 7);
      const summary = database.getPersonalSummary(month);
      const portfolios = database.listPortfolios({ limit: 200 })
        .filter((p) => p.portfolioType === 'INITIAL' || p.period === month)
        .map((p) => ({
          ...p,
          projection: monthlyCoverageProjection(p.coveragePct / 100, p.plannedDraws),
        }));
      return sendJson(res, 200, { ...summary, portfolios });
    }

    if (req.method === 'GET' && url.pathname === '/api/draws') {
      const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') || 200)));
      const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
      return sendJson(res, 200, { total: database.getDrawCount(), items: database.listDraws({ limit, offset }) });
    }

    if (req.method === 'GET' && url.pathname === '/api/stats') {
      return sendJson(res, 200, buildStats({ window: url.searchParams.get('window') || 'all' }));
    }

    if (req.method === 'GET' && url.pathname === '/api/scrape/status') return sendJson(res, 200, scrapeJob);

    if (req.method === 'POST' && url.pathname === '/api/scrape') {
      if (scrapeJob.running) return sendJson(res, 409, { error: 'Import già in esecuzione', job: scrapeJob });
      const body = await readJson(req);
      if (!validDate(body.from) || !validDate(body.to)) return sendJson(res, 400, { error: 'from e to devono essere YYYY-MM-DD' });
      const today = new Date().toISOString().slice(0, 10);
      if (body.to > today) return sendJson(res, 400, { error: `to non può essere nel futuro (${today})` });
      const delayMs = Math.max(250, Number(body.delayMs || process.env.SCRAPE_DELAY_MS || 1000));
      const force = Boolean(body.force);

      scrapeJob = {
        running: true,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        request: { from: body.from, to: body.to, delayMs, force },
        progress: null,
        result: null,
        error: null,
      };

      scrapeRange({
        from: body.from,
        to: body.to,
        delayMs,
        force,
        onProgress(progress) { scrapeJob.progress = progress; },
      }).then((result) => {
        scrapeJob.running = false;
        scrapeJob.finishedAt = new Date().toISOString();
        scrapeJob.result = result;
      }).catch((error) => {
        scrapeJob.running = false;
        scrapeJob.finishedAt = new Date().toISOString();
        scrapeJob.error = error instanceof Error ? error.message : String(error);
      });
      return sendJson(res, 202, { accepted: true, job: scrapeJob });
    }

    if (req.method === 'POST' && url.pathname === '/api/portfolio/evaluate') {
      const body = await readJson(req);
      if (!Array.isArray(body.tickets) || !body.tickets.length) return sendJson(res, 400, { error: 'tickets deve essere un array non vuoto' });
      return sendJson(res, 200, evaluatePortfolio(body.tickets, body.mode || '1e'));
    }

    if (req.method === 'POST' && url.pathname === '/api/portfolio/optimize') {
      const body = await readJson(req);
      const result = optimizePortfolio({
        tickets: Number(body.tickets || 5),
        mode: body.mode || '1e',
        seed: Number(body.seed || 42),
        iterations: Math.min(10000, Math.max(100, Number(body.iterations || 1200))),
        sampleSize: Math.min(20000, Math.max(2000, Number(body.sampleSize || 12000))),
      });
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/coverage/plan') {
      const body = await readJson(req);
      const result = buildCoveragePlan({
        minBudgetEuro: Math.max(1, Number(body.minBudgetEuro || 1)),
        maxBudgetEuro: Math.min(200, Math.max(1, Number(body.maxBudgetEuro || 20))),
        mode: body.mode || '1e',
        seed: Number(body.seed || 42),
        maxPoints: Math.min(20, Math.max(2, Number(body.maxPoints || 12))),
        candidatesPerTicket: Math.min(160, Math.max(20, Number(body.candidatesPerTicket || 60))),
        sampleSize: Math.min(10000, Math.max(2000, Number(body.sampleSize || 4000))),
      });
      return sendJson(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/portfolios') return sendJson(res, 200, { items: database.listPortfolios({ limit: 200 }) });

    if (req.method === 'POST' && url.pathname === '/api/portfolios') {
      const body = await readJson(req);
      const { exact, mode, normalizedTickets } = portfolioPayloadFromBody(body);
      const saved = database.savePortfolio({
        name: body.name,
        portfolioType: body.portfolioType,
        period: validMonth(body.period) ? body.period : null,
        mode,
        tickets: normalizedTickets,
        seed: body.seed,
        iterations: body.iterations,
        algorithm: body.algorithm || 'manual-or-optimized',
        coverageCount: exact.covered,
        universeSize: exact.universeSize,
        coveragePct: exact.percentage,
        baselinePct: body.baselinePct,
        plannedDraws: Number(body.plannedDraws || 1),
        notes: body.notes,
        status: body.status,
      });
      return sendJson(res, 201, saved);
    }

    const playPortfolioMatch = url.pathname.match(/^\/api\/portfolios\/(\d+)\/play$/);
    if (req.method === 'POST' && playPortfolioMatch) {
      const body = await readJson(req);
      const result = database.registerPortfolioPlay(Number(playPortfolioMatch[1]), {
        targetDrawDate: body.targetDrawDate,
        targetDrawTime: body.targetDrawTime,
      });
      return sendJson(res, 201, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/plays') {
      const month = validMonth(url.searchParams.get('month')) ? url.searchParams.get('month') : null;
      return sendJson(res, 200, { items: database.listPlays({ month, limit: 1000 }) });
    }

    if (req.method === 'POST' && url.pathname === '/api/plays/manual') {
      const body = await readJson(req);
      return sendJson(res, 201, database.registerManualPlay(body));
    }

    if (req.method === 'POST' && url.pathname === '/api/plays/settle') {
      return sendJson(res, 200, database.settleOpenPlays());
    }

    const payoutMatch = url.pathname.match(/^\/api\/plays\/(\d+)\/payout$/);
    if (req.method === 'PUT' && payoutMatch) {
      const body = await readJson(req);
      return sendJson(res, 200, database.updatePlayPayout(Number(payoutMatch[1]), Number(body.payoutCents || 0), body.notes));
    }

    if (req.method === 'GET' && url.pathname === '/api/info') {
      return sendJson(res, 200, {
        game: 'Win for Life Classico',
        baseUniverse: 184756,
        choose: '10 numeri da 1..20 + Numerone 1..20',
        modes: {
          '1e': 'coverage premio principale per 7/8/9/10 numeri',
          '2e': 'coverage premio principale anche per 0/1/2/3 numeri',
        },
        guaranteeMeaning: '100% significa che per ogni possibile estrazione dei 10 numeri principali almeno una schedina rientra in una categoria coperta. Non significa profitto garantito e non include il valore monetario del premio.',
        notes: [
          'Le giocate passate non cambiano la probabilità delle estrazioni future se queste sono indipendenti.',
          'Il database personale serve a misurare spesa, ROI osservato, varianza e performance reale del metodo.',
          'L optimizer è euristico; la coverage dichiarata del portfolio finale è invece calcolata esattamente sui 184.756 esiti.',
        ],
      });
    }

    if (req.method === 'GET' && serveStatic(url.pathname, res)) return;
    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    return sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Win for Life Analyzer v0.2.0: http://0.0.0.0:${port}`);
});
