// Print the typing plans the planner builds for a notebook's typing cells.
// Usage: node scripts/show_plan.ts NOTEBOOK.ipynb [MAX_CELLS]
import { readFileSync } from 'node:fs';
import { makePlan } from '../src/planner.ts';

const nb = JSON.parse(readFileSync(process.argv[2], 'utf-8'));
const max = Number(process.argv[3] ?? 1000);
const pairs = nb.cells
  .map((c: any) => c.metadata?.clm?.typing)
  .filter((t: any) => t && typeof t.target === 'string');

for (const t of pairs.slice(0, max)) {
  const plan = makePlan(t.start ?? '', t.target);
  console.log(`=== ${plan.steps.length} steps${plan.fallback ? ' (FALLBACK)' : ''}`);
  let doc = plan.start;
  plan.steps.forEach((step, i) => {
    const parts = step.ops.map(op => {
      if (op.kind === 'type') {
        doc = doc.slice(0, op.at) + op.text + doc.slice(op.at);
        return `type ${JSON.stringify(op.text)}`;
      }
      const removed = doc.slice(op.from, op.to);
      doc = doc.slice(0, op.from) + doc.slice(op.to);
      return `select+delete ${JSON.stringify(removed)}`;
    });
    console.log(String(i + 1).padStart(3), parts.join(' ; '));
  });
}
