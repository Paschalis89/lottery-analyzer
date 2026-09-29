import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveUrlForDate, parseArchiveHtml } from '../src/scraper.js';

test('parser archivio stile ufficiale', () => {
  const html = `
    <html><body>
      <div>Nº 3503 del 26 Luglio 2026</div><div>07:00</div>
      <span>1</span><span>2</span><span>7</span><span>8</span><span>12</span>
      <span>15</span><span>16</span><span>17</span><span>19</span><span>20</span><span>4</span>
      <div>Nº 3504 del 26 Luglio 2026</div><div>08:00</div>
      <span>3</span><span>5</span><span>6</span><span>7</span><span>9</span>
      <span>10</span><span>11</span><span>17</span><span>19</span><span>20</span><span>16</span>
    </body></html>`;
  const draws = parseArchiveHtml(html, 'https://example.test/source');
  assert.equal(draws.length, 2);
  assert.equal(draws[0].contest, 3503);
  assert.equal(draws[0].drawDate, '2026-07-26');
  assert.equal(draws[0].drawTime, '07:00');
  assert.deepEqual(draws[0].numbers, [1,2,7,8,12,15,16,17,19,20]);
  assert.equal(draws[0].numerone, 4);
});

test('url archivio', () => {
  assert.equal(archiveUrlForDate('2026-07-26'), 'https://www.winforlife.it/archivio-estrazioni-classico/2026/luglio/26');
});
