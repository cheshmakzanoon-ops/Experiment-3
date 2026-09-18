import { readFileSync, statSync } from 'node:fs';
import { comparePerformance, readPerformanceReport } from '../src/core/performance.ts';

try {
  const paths = process.argv.slice(2);
  if (paths.length !== 2) throw new Error('Usage: npm run test:performance -- baseline.json candidate.json');
  const reports = paths.map((path) => {
    if (statSync(path).size > 12_000_000) throw new Error('Performance report exceeds 12 MB');
    return readPerformanceReport(JSON.parse(readFileSync(path, 'utf8')));
  });
  const result = comparePerformance(reports[0], reports[1]);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.comparable ? (result.passed ? 0 : 1) : 2;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
