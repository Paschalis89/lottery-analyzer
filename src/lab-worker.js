import { parentPort, workerData } from 'node:worker_threads';
import { optimizeLabPortfolio, analyzePortfolio } from './portfolio-lab.js';
try {
  const result = workerData.task === 'analyze'
    ? analyzePortfolio(workerData.input)
    : optimizeLabPortfolio(workerData.input);
  parentPort.postMessage({ ok: true, result });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
}
