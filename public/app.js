const $ = (id) => document.getElementById(id);
let optimizerResult = null;
let lastFinishedScrape = null;

function localDateIso(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function localMonthIso() { return localDateIso().slice(0, 7); }
function euro(cents) { return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format((Number(cents) || 0) / 100); }
function pct(value, digits = 2) { return `${(Number(value) || 0).toFixed(digits)}%`; }
function centsFromEuro(value) { return Math.round((Number(value) || 0) * 100); }
function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function balls(numbers, numerone = null) {
  return `<div class="balls">${numbers.map((n) => `<span class="ball">${n}</span>`).join('')}${numerone ? `<span class="ball numerone">N${numerone}</span>` : ''}</div>`;
}

$('toDate').value = localDateIso();
$('dashboardMonth').value = localMonthIso();
$('portfolioPeriod').value = localMonthIso();
$('manualPortfolioPeriod').value = localMonthIso();
$('manualPlayDate').value = localDateIso();

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function refreshHealth() {
  try {
    const data = await api('/api/health');
    $('healthPill').textContent = 'Online';
    $('healthPill').classList.add('ok');
    $('drawCount').textContent = data.drawCount.toLocaleString('it-IT');
    $('latestContest').textContent = data.latestDraw ? `#${data.latestDraw.contest}` : '—';
    $('latestDate').textContent = data.latestDraw ? `${data.latestDraw.drawDate} ${data.latestDraw.drawTime}` : '—';
    $('annualSummary').innerHTML = data.annualDraws.length
      ? data.annualDraws.map((y) => `<span class="chip"><strong>${esc(y.year)}</strong> · ${y.count.toLocaleString('it-IT')} · fino a ${esc(y.last_draw)}</span>`).join('')
      : '<span class="chip">Nessun dato</span>';
  } catch (error) {
    $('healthPill').textContent = error.message;
    $('healthPill').classList.remove('ok');
  }
}

async function refreshProfile() {
  const p = await api('/api/profile');
  $('displayName').value = p.displayName;
  $('initialBankroll').value = (p.initialBankrollCents / 100).toFixed(2);
  $('monthlyBudget').value = (p.monthlyBudgetCents / 100).toFixed(2);
  $('defaultMode').value = p.defaultMode;
  $('mode').value = p.defaultMode;
  $('coverageMode').value = p.defaultMode;
  $('manualPortfolioMode').value = p.defaultMode;
  $('manualPlayMode').value = p.defaultMode;
}

async function refreshDashboard() {
  const month = $('dashboardMonth').value || localMonthIso();
  const data = await api(`/api/dashboard?month=${encodeURIComponent(month)}`);
  $('bankroll').textContent = euro(data.bankrollCents);
  $('monthSpent').textContent = euro(data.monthly.spentCents);
  $('monthRemaining').textContent = euro(data.monthlyRemainingCents);
  $('monthPayout').textContent = euro(data.monthly.payoutCents);
  $('monthRoi').textContent = pct(data.monthly.roiPct);
  $('monthRoi').className = data.monthly.roiPct >= 0 ? 'good' : 'error';
  $('monthWins').textContent = `${data.monthly.winning}/${data.monthly.settled}`;
  $('totalRoi').textContent = pct(data.total.roiPct);
  $('totalRoi').className = data.total.roiPct >= 0 ? 'good' : 'error';

  $('monthlyProjectionBody').innerHTML = data.portfolios.length ? data.portfolios.map((p) => `
    <tr>
      <td>${esc(p.name)}</td>
      <td>${esc(p.portfolioType)}</td>
      <td>${euro(p.budgetCents)}</td>
      <td>${pct(p.coveragePct, 4)}</td>
      <td>${p.plannedDraws}</td>
      <td>${pct(p.projection.probabilityAtLeastOne * 100, 4)}</td>
      <td>${p.projection.expectedCoveredDraws.toFixed(2)}</td>
    </tr>`).join('') : '<tr><td colspan="7">Nessun portafoglio iniziale/mensile per questo mese.</td></tr>';
}

$('profileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/profile', {
      method: 'PUT',
      body: JSON.stringify({
        displayName: $('displayName').value,
        initialBankrollCents: centsFromEuro($('initialBankroll').value),
        monthlyBudgetCents: centsFromEuro($('monthlyBudget').value),
        defaultMode: $('defaultMode').value,
      }),
    });
    $('profileMsg').innerHTML = '<span class="good">Profilo salvato.</span>';
    await refreshDashboard();
  } catch (error) {
    $('profileMsg').innerHTML = `<span class="error">${esc(error.message)}</span>`;
  }
});
$('dashboardMonth').addEventListener('change', async () => { await Promise.all([refreshDashboard(), refreshPlays()]); });

async function refreshDraws() {
  const data = await api('/api/draws?limit=25');
  $('drawsBody').innerHTML = data.items.length ? data.items.map((d) => `
    <tr><td>#${d.contest}</td><td>${d.drawDate}</td><td>${d.drawTime}</td><td>${d.numbers.join(' · ')}</td><td><strong>${d.numerone}</strong></td></tr>`).join('')
    : '<tr><td colspan="5">Nessun dato.</td></tr>';
}

async function refreshStats() {
  const stats = await api(`/api/stats?window=${encodeURIComponent($('statsWindow').value)}`);
  const delays = new Map(stats.delays.map((d) => [d.number, d]));
  $('freqBody').innerHTML = stats.frequency.map((f) => {
    const d = delays.get(f.number);
    return `<tr><td><strong>${f.number}</strong></td><td>${f.count}</td><td>${pct(f.percentage)}</td><td class="${Math.abs(f.zScore) >= 2 ? 'error' : ''}">${f.zScore.toFixed(2)}</td><td>${d?.currentDelay ?? 0}</td><td>${d?.maxDelay ?? 0}</td></tr>`;
  }).join('') || '<tr><td colspan="6">Importa alcune estrazioni.</td></tr>';
  $('pairs').innerHTML = stats.topPairs.map((p) => `<span class="chip">${p.pair.join('–')} · ${p.count}</span>`).join('') || '<span class="chip">Nessun dato</span>';
  const numeroni = [...stats.numeroneFrequency].sort((a, b) => b.count - a.count).slice(0, 10);
  $('numeroni').innerHTML = numeroni.map((n) => `<span class="chip">${n.number} · ${n.count} (${pct(n.percentage)})</span>`).join('') || '<span class="chip">Nessun dato</span>';
}
$('refreshStats').addEventListener('click', refreshStats);
$('statsWindow').addEventListener('change', refreshStats);

async function refreshScrapeStatus() {
  try {
    const job = await api('/api/scrape/status');
    const p = job.progress;
    if (!job.startedAt) {
      $('scrapeStatus').textContent = 'Nessun job avviato.';
      $('progressBar').style.width = '0%';
      return;
    }
    const total = p?.daysTotal || 0;
    const index = p?.index || 0;
    $('progressBar').style.width = `${total ? Math.min(100, (index / total) * 100).toFixed(1) : 0}%`;
    $('scrapeStatus').textContent = JSON.stringify({
      running: job.running,
      currentDate: p?.currentDate,
      progress: total ? `${index}/${total}` : null,
      drawsAdded: p?.drawsAdded ?? job.result?.drawsAdded ?? 0,
      daysWarning: p?.daysWarning ?? job.result?.daysWarning ?? 0,
      daysFailed: p?.daysFailed ?? job.result?.daysFailed ?? 0,
      finishedAt: job.finishedAt,
      error: job.error,
    }, null, 2);
    if (!job.running && job.finishedAt && job.finishedAt !== lastFinishedScrape) {
      lastFinishedScrape = job.finishedAt;
      await Promise.all([refreshHealth(), refreshDraws(), refreshStats()]);
    }
  } catch (error) {
    $('scrapeStatus').textContent = error.message;
  }
}
$('scrapeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  if (button) button.disabled = true;
  try {
    await api('/api/scrape', { method: 'POST', body: JSON.stringify({ from: $('fromDate').value, to: $('toDate').value, delayMs: Number($('delayMs').value), force: $('force').checked }) });
    await refreshScrapeStatus();
  } catch (error) {
    $('scrapeStatus').textContent = error.message;
  } finally { if (button) button.disabled = false; }
});
$('recentBtn').addEventListener('click', () => { const d = new Date(); d.setDate(d.getDate() - 29); $('fromDate').value = d.toISOString().slice(0,10); $('toDate').value = localDateIso(); });

$('optimizerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $('optimizerMeta').textContent = 'Calcolo in corso...';
  $('portfolio').innerHTML = '';
  $('saveOptimizerPortfolio').disabled = true;
  try {
    optimizerResult = await api('/api/portfolio/optimize', {
      method: 'POST',
      body: JSON.stringify({ tickets: Number($('tickets').value), mode: $('mode').value, iterations: Number($('iterations').value), seed: Number($('seed').value) }),
    });
    const e = optimizerResult.exact;
    const baseline = optimizerResult.baselineExact;
    const delta = e.percentage - baseline.percentage;
    $('optimizerMeta').innerHTML = `
      <strong class="${e.guaranteedHit ? 'good' : ''}">Coverage esatta: ${pct(e.percentage,4)}</strong><br>
      ${e.covered.toLocaleString('it-IT')} / ${e.universeSize.toLocaleString('it-IT')} esiti coperti · ${e.uncovered.toLocaleString('it-IT')} scoperti.<br>
      Random iniziale stesso seed: ${pct(baseline.percentage,4)} · delta ${delta >= 0 ? '+' : ''}${delta.toFixed(4)} punti.<br>
      ${e.guaranteedHit ? '<strong class="good">100%: almeno una categoria principale coperta per ogni possibile esito. Non equivale a profitto garantito.</strong><br>' : ''}
      Algoritmo ${esc(optimizerResult.algorithm)}; optimum globale <strong>non garantito</strong>.
    `;
    $('portfolio').innerHTML = optimizerResult.portfolio.map((ticket, i) => `<div class="ticket"><strong>Combinazione ${i + 1}</strong>${balls(ticket.numbers, ticket.numerone)}</div>`).join('');
    $('saveOptimizerPortfolio').disabled = false;
  } catch (error) {
    $('optimizerMeta').innerHTML = `<span class="error">${esc(error.message)}</span>`;
  } finally { button.disabled = false; }
});

$('saveOptimizerPortfolio').addEventListener('click', async () => {
  if (!optimizerResult) return;
  const type = $('portfolioType').value;
  if (type === 'MONTHLY' && !$('portfolioPeriod').value) {
    $('savePortfolioMsg').innerHTML = '<span class="error">Seleziona il mese del portfolio.</span>';
    return;
  }
  try {
    const saved = await api('/api/portfolios', {
      method: 'POST',
      body: JSON.stringify({
        name: $('portfolioName').value,
        portfolioType: type,
        period: $('portfolioPeriod').value || null,
        mode: optimizerResult.exact.mode,
        tickets: optimizerResult.portfolio,
        seed: optimizerResult.seed,
        iterations: optimizerResult.iterations,
        algorithm: optimizerResult.algorithm,
        baselinePct: optimizerResult.baselineExact.percentage,
        plannedDraws: Number($('plannedDraws').value || 1),
      }),
    });
    $('savePortfolioMsg').innerHTML = `<span class="good">Salvato portfolio #${saved.id}: coverage ${pct(saved.coveragePct,4)}, costo pianificato ${euro(saved.budgetCents)}.</span>`;
    await Promise.all([refreshPortfolios(), refreshDashboard()]);
  } catch (error) {
    $('savePortfolioMsg').innerHTML = `<span class="error">${esc(error.message)}</span>`;
  }
});

$('coverageForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $('coverageBody').innerHTML = '<tr><td colspan="5">Calcolo in corso...</td></tr>';
  $('coverageMeta').textContent = '';
  try {
    const result = await api('/api/coverage/plan', {
      method: 'POST',
      body: JSON.stringify({ minBudgetEuro: Number($('minBudget').value), maxBudgetEuro: Number($('maxBudget').value), mode: $('coverageMode').value, maxPoints: Number($('maxPoints').value), seed: Number($('coverageSeed').value) }),
    });
    $('coverageMeta').innerHTML = `${esc(result.algorithm)} · optimum globale non garantito. <strong>Una riga al 100% è comunque verificata esattamente.</strong>`;
    $('coverageBody').innerHTML = result.rows.map((r) => `
      <tr><td>€${r.costEuro.toFixed(2)}</td><td>${r.tickets}</td><td><strong>${pct(r.coveragePct,4)}</strong></td><td>${r.uncovered.toLocaleString('it-IT')}</td><td>${r.guaranteedHit ? '<span class="badge good">SÌ · coverage 100%</span>' : '<span class="badge">No</span>'}</td></tr>`).join('');
  } catch (error) {
    $('coverageBody').innerHTML = `<tr><td colspan="5" class="error">${esc(error.message)}</td></tr>`;
  } finally { button.disabled = false; }
});

function parseManualPortfolio(text) {
  const lines = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (!lines.length) throw new Error('Inserisci almeno una combinazione');
  return lines.map((line, index) => {
    const parts = line.split('|');
    const numbers = (parts[0].match(/\d+/g) || []).map(Number);
    if (numbers.length !== 10 || new Set(numbers).size !== 10 || numbers.some((n) => n < 1 || n > 20)) throw new Error(`Riga ${index + 1}: servono 10 numeri distinti da 1 a 20`);
    const n = parts[1] ? Number((parts[1].match(/\d+/) || [])[0]) : ((index % 20) + 1);
    if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error(`Riga ${index + 1}: Numerone non valido`);
    return { numbers: [...numbers].sort((a,b) => a-b), numerone: n };
  });
}

$('manualPortfolioForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const tickets = parseManualPortfolio($('manualPortfolioTickets').value);
    const saved = await api('/api/portfolios', {
      method: 'POST',
      body: JSON.stringify({ name: $('manualPortfolioName').value, portfolioType: $('manualPortfolioType').value, period: $('manualPortfolioPeriod').value || null, mode: $('manualPortfolioMode').value, tickets, plannedDraws: 1, algorithm: 'manual' }),
    });
    $('manualPortfolioMsg').innerHTML = `<span class="good">Portfolio #${saved.id} salvato. Coverage esatta ${pct(saved.coveragePct,4)}.</span>`;
    await Promise.all([refreshPortfolios(), refreshDashboard()]);
  } catch (error) { $('manualPortfolioMsg').innerHTML = `<span class="error">${esc(error.message)}</span>`; }
});

async function refreshPortfolios() {
  const data = await api('/api/portfolios');
  $('savedPortfolios').innerHTML = data.items.length ? data.items.map((p) => `
    <article class="saved-portfolio">
      <div class="saved-portfolio-head">
        <div><strong>#${p.id} · ${esc(p.name)}</strong><div class="saved-portfolio-meta">${esc(p.portfolioType)} ${p.period ? '· ' + esc(p.period) : ''} · ${p.mode === '1e' ? '1 €' : '2 €'} · ${p.ticketsCount} combinazioni · coverage ${pct(p.coveragePct,4)} · ${euro(p.budgetCents)} pianificati</div></div>
        ${p.guaranteedHit ? '<span class="badge good">Coverage 100%</span>' : `<span class="badge">${p.universeSize - p.coverageCount} esiti scoperti</span>`}
      </div>
      <details><summary>Mostra combinazioni</summary><div class="portfolio">${p.tickets.map((t) => `<div class="ticket"><strong>#${t.position}</strong>${balls(t.numbers,t.numerone)}</div>`).join('')}</div></details>
      <div class="portfolio-actions">
        <label>Data<input type="date" class="play-date" data-id="${p.id}" value="${localDateIso()}" /></label>
        <label>Ora<input type="time" class="play-time" data-id="${p.id}" value="20:00" /></label>
        <button type="button" class="play-portfolio" data-id="${p.id}">Registra come giocato</button>
      </div>
    </article>`).join('') : '<div class="small-msg">Nessun portfolio salvato.</div>';
}
$('refreshPortfolios').addEventListener('click', refreshPortfolios);
$('savedPortfolios').addEventListener('click', async (event) => {
  const button = event.target.closest('.play-portfolio');
  if (!button) return;
  const id = button.dataset.id;
  const date = document.querySelector(`.play-date[data-id="${id}"]`)?.value;
  const time = document.querySelector(`.play-time[data-id="${id}"]`)?.value;
  button.disabled = true;
  try {
    const result = await api(`/api/portfolios/${id}/play`, { method: 'POST', body: JSON.stringify({ targetDrawDate: date, targetDrawTime: time }) });
    button.textContent = `Salvate ${result.playsCreated} giocate`;
    await Promise.all([refreshPlays(), refreshDashboard(), refreshPortfolios()]);
  } catch (error) {
    alert(error.message);
  } finally { button.disabled = false; }
});

$('manualPlayForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const numbers = ($('manualPlayNumbers').value.match(/\d+/g) || []).map(Number);
  try {
    await api('/api/plays/manual', { method: 'POST', body: JSON.stringify({ targetDrawDate: $('manualPlayDate').value, targetDrawTime: $('manualPlayTime').value, mode: $('manualPlayMode').value, numbers, numerone: Number($('manualPlayNumerone').value) }) });
    $('manualPlayNumbers').value = '';
    await Promise.all([refreshPlays(), refreshDashboard()]);
  } catch (error) { alert(error.message); }
});

async function refreshPlays() {
  const month = $('dashboardMonth').value || localMonthIso();
  const data = await api(`/api/plays?month=${encodeURIComponent(month)}`);
  $('playsBody').innerHTML = data.items.length ? data.items.map((p) => `
    <tr>
      <td>#${p.id}</td><td>${p.targetDrawDate} ${p.targetDrawTime}</td><td>${esc(p.portfolioName || 'Manuale')}</td>
      <td>${p.numbers.join(' · ')}</td><td>${p.numerone}</td><td>${euro(p.costCents)}</td>
      <td>${p.status === 'OPEN' ? '<span class="badge warn">OPEN</span>' : `${p.hits} hit${p.numeroneHit ? ' + N' : ''}`}</td>
      <td>${esc(p.category || '—')}</td><td>${p.payoutConfirmed ? euro(p.payoutCents) : '<span class="warn">da inserire</span>'}</td>
      <td>${p.status === 'SETTLED' ? `<button type="button" class="set-payout secondary" data-id="${p.id}">Premio €</button>` : '—'}</td>
    </tr>`).join('') : '<tr><td colspan="10">Nessuna giocata nel mese selezionato.</td></tr>';
}
$('refreshPlays').addEventListener('click', refreshPlays);
$('settlePlays').addEventListener('click', async () => {
  try {
    const r = await api('/api/plays/settle', { method: 'POST', body: '{}' });
    $('settlePlays').textContent = `Abbinati ${r.settled}`;
    await Promise.all([refreshPlays(), refreshDashboard()]);
  } catch (error) { alert(error.message); }
});
$('playsBody').addEventListener('click', async (event) => {
  const button = event.target.closest('.set-payout');
  if (!button) return;
  const value = prompt('Premio effettivamente incassato in euro (0 se nessun premio):', '0');
  if (value === null) return;
  const amount = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(amount) || amount < 0) return alert('Importo non valido');
  try {
    await api(`/api/plays/${button.dataset.id}/payout`, { method: 'PUT', body: JSON.stringify({ payoutCents: Math.round(amount * 100) }) });
    await Promise.all([refreshPlays(), refreshDashboard()]);
  } catch (error) { alert(error.message); }
});

await Promise.all([refreshHealth(), refreshProfile(), refreshDashboard(), refreshDraws(), refreshStats(), refreshScrapeStatus(), refreshPortfolios(), refreshPlays()]);
setInterval(refreshScrapeStatus, 2500);
