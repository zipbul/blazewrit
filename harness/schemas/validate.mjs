#!/usr/bin/env node
// Guards harness/schemas/. Run: `bun run schemas:check` (or `node harness/schemas/validate.mjs`).
// Asserts: (1) every schema compiles + all $refs resolve, (2) no M4 primitive drift,
// (3) the R23/R22 unrepresentability invariants hold, (4) the 3 fixed grammar bugs stay fixed.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(DIR).filter((f) => f.endsWith('.schema.json'));
const docs = Object.fromEntries(files.map((f) => [f, JSON.parse(readFileSync(join(DIR, f), 'utf8'))]));

// x-validator-contract / x-m2-* are intentional design annotations (M2 sibling checks),
// not enforced keywords — strict:false lets them through while refs/shape are still checked.
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
addFormats(ajv);
for (const doc of Object.values(docs)) {
  if (doc.$id) ajv.addSchema(doc, doc.$id);
}

let fail = 0;
const ok = (name) => console.log(`  ✅ ${name}`);
const bad = (name, msg) => { fail++; console.log(`  🔴 ${name}\n       ${msg}`); };
const idOf = (f) => docs[f].$id;
const validatorFor = (f) => ajv.getSchema(idOf(f)) || ajv.compile(docs[f]);

// ---- 1. every schema compiles (catches broken $ref / invalid schema) ----
console.log('1. compile + ref resolution');
for (const f of files) {
  try { validatorFor(f); ok(f); }
  catch (e) { bad(f, String(e.message).split('\n')[0]); }
}

// ---- 2. M4: no step re-invents a _defs primitive ----
console.log('2. M4 primitive drift (no step redefines a shared $def)');
const defNames = new Set(Object.keys(docs['_defs.schema.json'].$defs || {}));
for (const f of files) {
  if (f === '_defs.schema.json') continue;
  const local = Object.keys(docs[f].$defs || {});
  const clash = local.filter((n) => defNames.has(n));
  clash.length ? bad(f, `redefines shared primitive(s): ${clash.join(', ')}`) : ok(f);
}

// ---- helper: validate an instance against a registered subschema by JSON-pointer ----
const check = (label, ref, instance, wantValid) => {
  const v = ajv.getSchema(ref);
  if (!v) return bad(label, `cannot resolve ${ref}`);
  const valid = v(instance);
  valid === wantValid
    ? ok(`${label} (${wantValid ? 'accepts' : 'rejects'})`)
    : bad(label, `expected ${wantValid ? 'VALID' : 'INVALID'}, got ${valid ? 'VALID' : 'INVALID'}: ${ajv.errorsText(v.errors)}`);
};

const DEFS = docs['_defs.schema.json'].$id;
const SHA = 'a'.repeat(64);
const CC = { value: 1, source: { command: 'ls', raw_stdout_sha256: SHA } };

// ---- 3. R23 / R22 unrepresentability ----
console.log('3. R23 CountClaim + R22 Omitted unrepresentability');
check('R23 CountClaim {value,source}', `${DEFS}#/$defs/CountClaim`, CC, true);
check('R23 bare integer', `${DEFS}#/$defs/CountClaim`, 1, false);
check('R23 missing source', `${DEFS}#/$defs/CountClaim`, { value: 1 }, false);
check('R22 Omitted {reason,source_tool}', `${DEFS}#/$defs/Omitted`, { status: 'omitted', reason: 'tool_absent', source_tool: 'typecheck' }, true);
check('R22 null', `${DEFS}#/$defs/DegradableMeasurement`, null, false);
check('R22 "# OMITTED" placeholder', `${DEFS}#/$defs/DegradableMeasurement`, '# OMITTED', false);

// ---- 4. regression: the 3 fixed grammar bugs ----
console.log('4. grammar-bug regressions');
// BUG1 implement.based_on: anyOf => carrying BOTH refs is allowed; neither is rejected
const impBasedOn = `${idOf('implement.schema.json')}#/properties/based_on`;
check('BUG1 implement both refs', impBasedOn, { spec_ref: 'r1', decide_ref: 'r2' }, true);
check('BUG1 implement neither ref', impBasedOn, { investigate_ref: 'r' }, false);

// BUG2 report: spike branch must be satisfiable (top-level unevaluatedProperties:false)
const VP = { command: 'npm test', expected_result: 'exit 0' };
const finding = { id: 'f1', statement: 's', severity: 'high', evidence_ref: { kind: 'row_ref', row_ref: 'r' }, verify_probe: VP, source_tool: 'investigate', unverified: false };
const reportCommon = { summary: 's', findings: [finding], action_items: [{ description: 'd', priority: 'high' }], based_on: { investigate_ref: 'r', decide_ref: 'r', ground_ref: 'r' }, declared_next_step: { declared_next_step: 'reflect' } };
check('BUG2 report spike branch', idOf('report.schema.json'),
  { ...reportCommon, report_type: 'spike', spike_verdict: { verdict: 'go' } }, true);
check('BUG2 report compound branch', idOf('report.schema.json'),
  { ...reportCommon, report_type: 'compound', sub_flow_summaries: { sub_flows: [{ flow_ref: 'r', outcome: 'done', source_tool: 'investigate' }], sub_flow_count: CC } }, true);

// BUG3 verify: a non_code verify carrying BOTH pass1 variants must be rejected
check('BUG3 verify both pass1 variants', idOf('verify.schema.json'),
  { result: 'pass', flow_kind: 'non_code', based_on: {}, internal_passes: { pass1_completeness: {}, pass1_mechanical: {} }, verdict_summary: 'x', self_misjudgment_check: { suspected: false } }, false);

console.log(`\n${fail === 0 ? '✅ ALL SCHEMA CHECKS PASS' : `🔴 ${fail} CHECK(S) FAILED`}`);
process.exit(fail === 0 ? 0 : 1);
