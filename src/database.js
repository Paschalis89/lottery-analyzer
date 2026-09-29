import path from 'node:path';
import { createDatabase } from './db.js';

const dataDir = process.env.DATA_DIR || path.resolve('data');
export const database = createDatabase(path.join(dataDir, 'winforlife.sqlite'), { migrateLegacy: true });
