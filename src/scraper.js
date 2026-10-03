import { database } from './database.js';

const MONTHS_IT = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];

const MONTH_INDEX = new Map(
  MONTHS_IT.map((month, index) => [month, index + 1]),
);

const WFL_LAUNCH_DATE = '2013-01-21';
const FULL_DAY_DRAW_COUNT = 17;
const LAUNCH_DAY_DRAW_COUNT = 12;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function isoDate(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function italyTodayIso() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function expectedDrawsForCompletedDay(date) {
  if (date === WFL_LAUNCH_DATE) {
    return LAUNCH_DAY_DRAW_COUNT;
  }

  return FULL_DAY_DRAW_COUNT;
}

function decodeHtml(input) {
  return input
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&ordm;|&#186;/gi, 'º')
    .replace(/&deg;|&#176;/gi, '°')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseArchiveHtml(html, sourceUrl = '') {
  const text = decodeHtml(html);

  const contestRegex =
    /N\s*(?:º|°|o)?\s*(\d+)\s+del\s+(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})\s+(\d{1,2}:\d{2})/giu;

  const matches = [...text.matchAll(contestRegex)];
  const draws = [];

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];

    const contest = Number(match[1]);
    const day = Number(match[2]);
    const monthName = match[3].toLowerCase();
    const year = Number(match[4]);
    const drawTime = match[5].padStart(5, '0');

    const month = MONTH_INDEX.get(monthName);

    if (!month) {
      continue;
    }

    const start =
      (match.index ?? 0) +
      match[0].length;

    const end =
      i + 1 < matches.length
        ? matches[i + 1].index ?? text.length
        : text.length;

    const segment = text.slice(start, end);

    const values = (
      segment.match(/\b(?:20|1\d|[1-9])\b/g) || []
    ).map(Number);

    if (values.length < 11) {
      continue;
    }

    const numbers = values.slice(0, 10);
    const numerone = values[10];

    if (new Set(numbers).size !== 10) {
      continue;
    }

    if (
      numbers.some((number) => number < 1 || number > 20) ||
      numerone < 1 ||
      numerone > 20
    ) {
      continue;
    }

    draws.push({
      contest,
      drawDate: isoDate(year, month, day),
      drawTime,
      numbers: [...numbers].sort((a, b) => a - b),
      numerone,
      sourceUrl,
      fetchedAt: new Date().toISOString(),
    });
  }

  return draws;
}

export function archiveUrlForDate(date) {
  const [year, month, day] = date
    .split('-')
    .map(Number);

  const monthName = MONTHS_IT[month - 1];

  if (!monthName) {
    throw new Error(`Data non valida: ${date}`);
  }

  return `https://www.winforlife.it/archivio-estrazioni-classico/${year}/${monthName}/${day}`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchWithRetry(
  url,
  {
    retries = 3,
    userAgent,
  } = {},
) {
  let lastError;

  for (
    let attempt = 0;
    attempt <= retries;
    attempt += 1
  ) {
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent':
            userAgent ||
            process.env.SCRAPE_USER_AGENT ||
            'Mozilla/5.0 (compatible; WinForLifeLocalAnalyzer/0.2)',

          accept:
            'text/html,application/xhtml+xml',

          'accept-language':
            'it-IT,it;q=0.9,en;q=0.8',
        },

        signal:
          AbortSignal.timeout(20_000),
      });

      if (response.ok) {
        return response;
      }

      if (
        ![
          429,
          500,
          502,
          503,
          504,
        ].includes(response.status)
      ) {
        throw new Error(
          `HTTP ${response.status}`,
        );
      }

      const retryAfter = Number(
        response.headers.get('retry-after'),
      );

      await sleep(
        Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : 1500 * (attempt + 1),
      );
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        await sleep(
          1500 * (attempt + 1),
        );
      }
    }
  }

  throw (
    lastError ||
    new Error('Fetch fallito')
  );
}

function enumerateDates(from, to) {
  const dates = [];

  const start = new Date(
    `${from}T12:00:00Z`,
  );

  const end = new Date(
    `${to}T12:00:00Z`,
  );

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start > end
  ) {
    throw new Error(
      'Range date non valido',
    );
  }

  for (
    let current = new Date(start);
    current <= end;
    current.setUTCDate(
      current.getUTCDate() + 1,
    )
  ) {
    dates.push(
      current
        .toISOString()
        .slice(0, 10),
    );
  }

  return dates;
}

function canSkipPreviouslyFetchedDay(
  date,
  previous,
  today,
  force,
) {
  /*
   * Se force=true:
   * ricontrolliamo sempre il giorno.
   */
  if (force) {
    return false;
  }

  /*
   * Se non abbiamo mai acquisito
   * questa data o era finita in errore,
   * la dobbiamo controllare.
   */
  if (
    !previous ||
    previous.status !== 'ok'
  ) {
    return false;
  }

  /*
   * IMPORTANTE:
   *
   * il giorno corrente NON viene mai
   * considerato definitivo.
   *
   * Esempio:
   *
   * 10:00 -> importiamo fino alle 10
   * 18:00 -> premi di nuovo Avvia import
   *
   * Deve ricontrollare oggi e inserire
   * 11, 12, 13 ... 18.
   */
  if (date === today) {
    return false;
  }

  /*
   * Per i giorni passati controlliamo
   * che il numero di estrazioni salvate
   * sia quello atteso.
   *
   * In questo modo recuperiamo anche
   * eventuali giornate che in passato
   * erano state marcate OK troppo presto.
   */
  const expected =
    expectedDrawsForCompletedDay(date);

  const previousCount =
    Number(previous.draws_count || 0);

  return previousCount >= expected;
}

export async function scrapeRange({
  from,
  to,
  delayMs = 1000,
  force = false,
  onProgress = () => {},
}) {
  const dates =
    enumerateDates(from, to);

  if (dates.length > 6000) {
    throw new Error(
      'Range troppo grande (max 6000 giorni per job)',
    );
  }

  const today =
    italyTodayIso();

  const result = {
    daysTotal: dates.length,
    daysFetched: 0,
    daysSkipped: 0,
    daysWarning: 0,
    daysFailed: 0,
    drawsParsed: 0,
    drawsAdded: 0,
    errors: [],
  };

  for (
    let index = 0;
    index < dates.length;
    index += 1
  ) {
    const date = dates[index];

    const previous =
      database.getScrapeDay(date);

    /*
     * Giorni già acquisiti completamente:
     * SKIP.
     *
     * Giorno corrente:
     * MAI skip.
     */
    if (
      canSkipPreviouslyFetchedDay(
        date,
        previous,
        today,
        force,
      )
    ) {
      result.daysSkipped += 1;

      onProgress({
        ...result,
        currentDate: date,
        index: index + 1,
      });

      continue;
    }

    const url =
      archiveUrlForDate(date);

    try {
      const response =
        await fetchWithRetry(url);

      const html =
        await response.text();

      const draws =
        parseArchiveHtml(
          html,
          url,
        );

      /*
       * database.addDraws()
       * deve usare INSERT OR IGNORE
       * oppure comunque evitare duplicati.
       *
       * Quindi possiamo tranquillamente
       * rileggere oggi più volte.
       *
       * Se nel DB abbiamo già:
       *
       * 07:00 ... 18:00
       *
       * e ora il sito contiene:
       *
       * 07:00 ... 21:00
       *
       * verranno aggiunte solamente:
       *
       * 19:00
       * 20:00
       * 21:00
       */
      const added =
        database.addDraws(draws);

      result.daysFetched += 1;
      result.drawsParsed +=
        draws.length;

      result.drawsAdded += added;

      /*
       * Se il parser non trova niente,
       * NON marchiamo la giornata
       * definitivamente come OK.
       */
      if (draws.length === 0) {
        result.daysWarning += 1;

        const message =
          'Pagina letta ma parser ha trovato 0 estrazioni: giornata non marcata come OK.';

        result.errors.push({
          date,
          message,
        });

        database.setScrapeDay(
          date,
          {
            status:
              'warning_empty',

            drawsCount: 0,

            sourceUrl:
              url,

            error:
              message,
          },
        );
      } else {
        /*
         * Anche oggi può essere status=ok.
         *
         * Non è un problema perché
         * canSkipPreviouslyFetchedDay()
         * forza comunque il refresh
         * del giorno corrente.
         *
         * Domani invece:
         *
         * se draws_count < 17
         * verrà automaticamente
         * ricontrollato.
         */
        database.setScrapeDay(
          date,
          {
            status:
              'ok',

            drawsCount:
              draws.length,

            sourceUrl:
              url,
          },
        );
      }
    } catch (error) {
      result.daysFailed += 1;

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      result.errors.push({
        date,
        message,
      });

      /*
       * Evitiamo che uno storico enorme
       * faccia crescere questo array
       * indefinitamente.
       */
      if (
        result.errors.length > 100
      ) {
        result.errors.shift();
      }

      database.setScrapeDay(
        date,
        {
          status:
            'error',

          error:
            message,

          sourceUrl:
            url,
        },
      );
    }

    onProgress({
      ...result,
      currentDate: date,
      index: index + 1,
    });

    /*
     * Piccolo delay per non fare
     * richieste aggressive.
     */
    if (
      index <
      dates.length - 1
    ) {
      await sleep(
        Math.max(
          250,
          Number(delayMs) || 1000,
        ),
      );
    }
  }

  return result;
}