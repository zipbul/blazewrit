import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStepExecutor } from '../src/orchestrator/infra/agent-step-executor';
import { buildStepPrompt } from '../src/harness/prompts';

// Live read-only smoke: run one real `ground` step via the Claude Agent SDK (this machine's
// Claude Code auth, no API key) against a throwaway temp dir.
const dir = mkdtempSync(join(tmpdir(), 'bw-smoke-'));
writeFileSync(join(dir, 'hello.txt'), 'blazewrit smoke file\n');
writeFileSync(join(dir, 'README.md'), '# smoke\nA tiny temp project.\n');

const executor = new AgentStepExecutor({
  cwd: dir,
  permissionMode: 'bypassPermissions',
  maxTurns: 4,
  promptFor: buildStepPrompt,
});

const outcome = await executor.produce({
  flowId: 'smoke',
  flowType: 'feature',
  step: 'ground',
  attempt: 1,
  request: 'List the files in this project and say what it is. Read-only.',
  priorOutputs: [],
});

console.log('CWD:', dir);
console.log('GROUND OUTPUT:\n', String(outcome.output).slice(0, 800));
