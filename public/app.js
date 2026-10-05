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

function labFormOptions() {
  const scenario = {};
  for (const key of ['base7', 'base8', 'base9', 'base10', 'bonus7', 'bonus8', 'bonus9']) {
    const field = 'quote' + key[0].toUpperCase() + key.slice(1);
    const value = Number($(field).value);
    if (!Number.isFinite(value) || value < 0) throw new Error('Quota ipotetica non valida: ' + key);
    scenario[key] = Math.round(value * 100);
  }
  return { goal: $('optimizerGoal').value, strategy: $('optimizerStrategy').value,
    quality: $('optimizerQuality').value, historyWindow: $('historyWindow').value,
    historicalWeight: Number($('historicalWeight').value), recentShare: Number($('recentShare').value), scenario };
}
function renderLabAnalysis(result, targetId = 'labAnalysis') {
  const f = result.financial, h = result.historical;
  const rate = (x) => x === null || x === undefined ? 'N/D' : pct(x, 4);
  const score = (x) => x === null || x === undefined ? 'N/D' : Number(x).toFixed(2) + ' / 100';
  $(targetId).innerHTML = `
    <h3>${result.name ? 'Analisi: ' + esc(result.name) : 'Probabilita e risultato economico'}</h3>
    <p>Spesa di questo portfolio: <strong>${euro(f.costCents)} per UN concorso</strong>.</p>
    <div class="table-wrap"><table><thead><tr><th>Misura</th><th>Probabilita</th><th>Significato</th></tr></thead><tbody>
      <tr><td>Almeno una categoria premiata</td><td>${pct(100 * f.anyPrizeProbability, 4)}</td><td>Non indica recupero della spesa</td></tr>
      <tr><td>Incasso lordo almeno pari alla spesa</td><td>${pct(100 * f.recoverProbability, 4)}</td><td>Condizionato alle quote ipotetiche</td></tr>
      <tr><td>Incasso lordo superiore alla spesa</td><td>${pct(100 * f.profitProbability, 4)}</td><td>NON probabilita di profitto netto reale</td></tr>
      <tr><td>Perdita nello scenario</td><td>${pct(100 * f.lossProbability, 4)}</td><td>Incasso lordo inferiore alla spesa</td></tr>
      <tr><td>Almeno una categoria rendita</td><td>${pct(100 * f.annuityProbability, 6)}</td><td>Rendita esclusa dai valori monetari del modello</td></tr>
    </tbody></table></div>
    <p><strong>Scenario, non previsione:</strong> incasso immediato lordo medio del modello ${euro(f.meanGrossCashCents)}; differenza media dalla spesa ${euro(f.meanGrossNetCents)}. Quote variabili, imposte e rendita non sono modellate come denaro incassato oggi.</p>
    <p class="small-msg">Verifica su ${f.outcomeCount.toLocaleString('it-IT')} esiti (numeri principali + Numerone). Esattezza del calcolo NON significa esattezza delle quote ipotizzate.</p>
    <h3>Confronto col passato: descrittivo, NON predittivo</h3>
    <div class="table-wrap"><table><thead><tr><th>Dataset</th><th>Estr. valide</th><th>Copertura retrospettiva</th><th>Score descrittivo</th></tr></thead><tbody>
      <tr><td>Recente</td><td>${h.recent.draws.toLocaleString('it-IT')}</td><td>${rate(h.recent.coveredPct)}</td><td>${score(h.recentScore)}</td></tr>
      <tr><td>Totale</td><td>${h.all.draws.toLocaleString('it-IT')}</td><td>${rate(h.all.coveredPct)}</td><td>${score(h.totalScore)}</td></tr>
    </tbody></table></div>
    <p class="small-msg">${esc(h.note)} Validazione predittiva fuori campione: <strong>NON eseguita</strong>. Pesi dello score scelti dall'utente, non validati come vantaggio.</p>`;
  if (result.personalEvidence) renderEvidence(result.personalEvidence);
}
function syncLabOptions() {
  const historicalOnly = $('optimizerStrategy').querySelector('option[value="historical"]');
  historicalOnly.disabled = $('optimizerGoal').value !== 'coverage';
  if (historicalOnly.disabled && $('optimizerStrategy').value === 'historical') $('optimizerStrategy').value = 'coverage';
  $('historicalWeight').disabled = $('optimizerStrategy').value !== 'hybrid';
}
$('optimizerGoal').addEventListener('change', syncLabOptions);
$('optimizerStrategy').addEventListener('change', syncLabOptions);
syncLabOptions();

$('optimizerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  optimizerResult = null;
  $('savePortfolioMsg').textContent = '';
  $('optimizerMeta').textContent = 'Calcolo in corso in un worker: confronto anche i portafogli salvati e rifinisco il risultato...';
  $('labAnalysis').innerHTML = '';
  $('portfolio').innerHTML = '';
  $('saveOptimizerPortfolio').disabled = true;
  try {
    optimizerResult = await api('/api/portfolio/optimize', { method: 'POST', body: JSON.stringify({
      ...labFormOptions(), tickets: Number($('tickets').value), mode: $('mode').value,
    }) });
    const e = optimizerResult.exact;
    const source = optimizerResult.retainedPortfolioId
      ? `Conservato il portfolio #${optimizerResult.retainedPortfolioId}: non ho trovato un risultato migliore con questi parametri.`
      : 'Risultato scelto tra i candidati valutati. Salvalo per confrontarlo nelle prossime ricerche.';
    const objectiveLabels = { coverage: 'Almeno una categoria premiata', profit: 'Superare la spesa nello scenario LORDO', recover: 'Recuperare la spesa nello scenario LORDO' };
    $('optimizerMeta').innerHTML = `
      <strong>Copertura categorie: ${pct(e.percentage, 4)}</strong> - ${e.covered.toLocaleString('it-IT')} esiti principali coperti su ${e.universeSize.toLocaleString('it-IT')}.<br>
      Obiettivo: <strong>${esc(objectiveLabels[optimizerResult.goal])}</strong>. Metodo: ${esc(optimizerResult.strategy)}.<br>
      ${esc(source)}<br>
      ${optimizerResult.savedCompared} portafogli salvati compatibili rivalutati; ${optimizerResult.starts} partenze, ${optimizerResult.iterationsPerStart} iterazioni ciascuna; ${optimizerResult.exactRefinementAttempts} tentativi di rifinitura esatta.<br>
      Riferimento casuale singolo: ${pct(optimizerResult.baselineExact.percentage, 4)} di copertura, non media statistica.<br>
      <span class="small-msg">Migliore risultato trovato, NON massimo globale dimostrato. Aumentare la qualita non garantisce un miglioramento. Il Numerone viene considerato nel modello economico.</span>`;
    renderLabAnalysis(optimizerResult);
    $('portfolio').innerHTML = optimizerResult.portfolio.map((ticket, i) => `<div class="ticket"><strong>Combinazione ${i + 1}</strong>${balls(ticket.numbers, ticket.numerone)}</div>`).join('');
    $('saveOptimizerPortfolio').disabled = false;
  } catch (error) { $('optimizerMeta').innerHTML = `<span class="error">${esc(error.message)}</span>`; }
  finally { button.disabled = false; }
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
        notes: JSON.stringify({ lab: { version: 4, goal: optimizerResult.goal, strategy: optimizerResult.strategy,
          quality: optimizerResult.quality, baseSeed: optimizerResult.baseSeed,
          historyWindow: optimizerResult.history.requestedWindow, analyzedDraws: optimizerResult.history.analyzedDraws,
          lastDate: optimizerResult.historical.all.lastDate, recentShare: optimizerResult.historical.recentShare,
          historicalWeight: optimizerResult.historicalWeight, scenario: optimizerResult.financial.scenario,
          conditionalRecoverProbability: optimizerResult.financial.recoverProbability,
          conditionalProfitProbability: optimizerResult.financial.profitProbability, predictionValidated: false } }),
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
  const data = await api('/api/portfolios?includeArchived=' + ($('showArchived').checked ? '1' : '0'));
  $('savedPortfolios').innerHTML = data.items.length ? data.items.map((p) => `
    <article class="saved-portfolio">
      <div class="saved-portfolio-head">
        <div><strong>#${p.id} - ${esc(p.name)}</strong><div class="saved-portfolio-meta">${esc(p.status)} - ${esc(p.portfolioType)} ${p.period ? '- ' + esc(p.period) : ''} - ${p.ticketsCount} combinazioni - ${euro(p.ticketCostCents * p.ticketsCount)} per concorso - coverage ${pct(p.coveragePct, 4)}</div></div>
      </div>
      <details><summary>Mostra combinazioni</summary><div class="portfolio">${p.tickets.map((t) => `<div class="ticket"><strong>#${t.position}</strong>${balls(t.numbers, t.numerone)}</div>`).join('')}</div></details>
      <div class="portfolio-actions">
        ${p.status === 'ARCHIVED' ? `<button class="restore-portfolio secondary" data-id="${p.id}" type="button">Ripristina</button>` : `
          <label>Data<input type="date" class="play-date" data-id="${p.id}" value="${localDateIso()}" /></label>
          <label>Ora<input type="time" class="play-time" data-id="${p.id}" value="20:00" /></label>
          <button type="button" class="play-portfolio" data-id="${p.id}">Registra come giocato</button>
          <button type="button" class="archive-portfolio secondary" data-id="${p.id}">Elimina dalla lista</button>`}
        <button class="analyze-portfolio secondary" data-id="${p.id}" type="button">Analizza con lo scenario attuale</button>
      </div>
    </article>`).join('') : '<div class="small-msg">Nessun portfolio attivo. Per vedere gli archiviati spunta la casella.</div>';
}
$('refreshPortfolios').addEventListener('click', () => refreshPortfolios().catch((e) => alert(e.message)));
$('showArchived').addEventListener('change', () => refreshPortfolios().catch((e) => alert(e.message)));
$('savedPortfolios').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  const id = button.dataset.id;
  button.disabled = true;
  try {
    if (button.classList.contains('archive-portfolio')) {
      if (!confirm('Eliminare il portfolio #' + id + ' dalla lista attiva? Le giocate e i premi restano intatti. Puoi ripristinarlo dagli archiviati.')) return;
      await api(`/api/portfolios/${id}`, { method: 'DELETE' });
    } else if (button.classList.contains('restore-portfolio')) {
      await api(`/api/portfolios/${id}/restore`, { method: 'POST', body: '{}' });
    } else if (button.classList.contains('analyze-portfolio')) {
      button.textContent = 'Analisi in corso...';
      const result = await api(`/api/portfolios/${id}/analyze`, { method: 'POST', body: JSON.stringify(labFormOptions()) });
      renderLabAnalysis(result, 'savedPortfolioAnalysis');
      $('savedPortfolioAnalysis').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (button.classList.contains('play-portfolio')) {
      const date = document.querySelector(`.play-date[data-id="${id}"]`)?.value;
      const time = document.querySelector(`.play-time[data-id="${id}"]`)?.value;
      const result = await api(`/api/portfolios/${id}/play`, { method: 'POST', body: JSON.stringify({ targetDrawDate: date, targetDrawTime: time }) });
      button.textContent = `Salvate ${result.playsCreated} giocate`;
    }
    await Promise.all([refreshPlays(), refreshDashboard(), refreshPortfolios(), refreshEvidence()]);
  } catch (error) { alert(error.message); }
  finally { button.disabled = false; }
});

function renderEvidence(data) {
  const row = (name, x) => `<tr><td>${name}</td><td>${x.plays}</td><td>${x.winning} / ${x.settled} concluse</td><td>${euro(x.spentCents)}</td><td>${euro(x.confirmedPayoutCents)}</td><td>${euro(x.recordedNetCents)}</td><td>${x.provisional ? 'PROVVISORIO: ' + x.unresolvedPlays + ' da completare' : 'Completo'}</td></tr>`;
  $('personalEvidence').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Periodo</th><th>Schedine</th><th>Premiate</th><th>Speso</th><th>Premi confermati</th><th>Saldo registrato</th><th>Stato</th></tr></thead><tbody>${row('Ultime ' + data.recentLimit + ' schedine (o tutte se meno)', data.recent)}${row('Tutte le schedine', data.all)}</tbody></table></div><p class="small-msg">${esc(data.note)}</p>`;
}
async function refreshEvidence() {
  renderEvidence(await api('/api/personal-evidence'));
}
$('refreshEvidence').addEventListener('click', () => refreshEvidence().catch((e) => alert(e.message)));

$('manualPlayForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const numbers = ($('manualPlayNumbers').value.match(/\d+/g) || []).map(Number);
  try {
    await api('/api/plays/manual', { method: 'POST', body: JSON.stringify({ targetDrawDate: $('manualPlayDate').value, targetDrawTime: $('manualPlayTime').value, mode: $('manualPlayMode').value, numbers, numerone: Number($('manualPlayNumerone').value) }) });
    $('manualPlayNumbers').value = '';
    await Promise.all([refreshPlays(), refreshDashboard(), refreshEvidence()]);
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
    await Promise.all([refreshPlays(), refreshDashboard(), refreshEvidence()]);
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
    await Promise.all([refreshPlays(), refreshDashboard(), refreshEvidence()]);
  } catch (error) { alert(error.message); }
});

await Promise.all([refreshHealth(), refreshProfile(), refreshDashboard(), refreshDraws(), refreshStats(), refreshScrapeStatus(), refreshPortfolios(), refreshPlays(), refreshEvidence()]);
setInterval(refreshScrapeStatus, 2500);
