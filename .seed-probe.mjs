import fs from 'node:fs';
import path from 'node:path';
import { writes } from './scripts/seed-data.mjs';
fs.mkdirSync("/var/folders/7j/mnjm36_d209gy0bxs_5748mr0000gn/T/oldie-stats-uq7Vi8", { recursive: true });
for (const [name, data] of Object.entries(writes)) {
  fs.writeFileSync(path.join("/var/folders/7j/mnjm36_d209gy0bxs_5748mr0000gn/T/oldie-stats-uq7Vi8", name + '.json'), JSON.stringify(data, null, 2));
}