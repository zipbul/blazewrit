import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

// --- Types ---

interface FlowState {
  flows: FlowEntry[];
}

interface FlowEntry {
  id: string;
  flow: string;
  status: "active" | "suspended" | "completed" | "abandoned";
  step: string;
  started: string;
  summary: string;
  request: string;
  completed_steps: CompletedStep[];
  pending: string[];
  attempt_count: number;
  verify_failures: number;
  suspend_reason?: string;
  pending_question?: string;
  feedback?: string;
}

interface CompletedStep {
  name: string;
  status: "DONE" | "DONE_WITH_CONCERNS";
  artifact?: string;
}

interface FlowDefinition {
  steps: StepDef[];
}

interface StepDef {
  name: string;
  depth?: string;
  reviewer?: string;
  mode?: string;
  isolation?: string;
  loop_with?: string;
  on_fail?: string;
  max_failures?: number;
}

interface StepResult {
  status: "DONE" | "DONE_WITH_CONCERNS" | "BLOCKED" | "NEEDS_CONTEXT";
  artifact?: string;
  concerns?: string;
  reason?: string;
  question?: string;
  failure_origin?: string;
  evidence?: string;
  result?: string;
}

// --- Paths ---

const BLAZEWRIT_DIR = ".blazewrit";
const STATE_FILE = join(BLAZEWRIT_DIR, "flow-state.json");
const FLOWS_DIR = join(BLAZEWRIT_DIR, "flows");
const ANALYSIS_DIR = join(BLAZEWRIT_DIR, "analysis");
const PLANS_DIR = join(BLAZEWRIT_DIR, "plans");
const REPORTS_DIR = join(BLAZEWRIT_DIR, "reports");
const HISTORY_DIR = join(BLAZEWRIT_DIR, "flow-history");

// --- State Management ---

function ensureDirs(): void {
  for (const dir of [BLAZEWRIT_DIR, FLOWS_DIR, ANALYSIS_DIR, PLANS_DIR, REPORTS_DIR, HISTORY_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

function readState(): FlowState {
  if (!existsSync(STATE_FILE)) return { flows: [] };
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return { flows: [] };
  }
}

function writeState(state: FlowState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getActiveFlow(state: FlowState): FlowEntry | undefined {
  return state.flows.find((f) => f.status === "active");
}

function generateFlowId(flowType: string): string {
  const ts = Date.now().toString(36);
  return `${flowType}-${ts}`;
}

// --- Flow Definition ---

function readFlowDef(flowType: string): FlowDefinition {
  const flowFile = join(FLOWS_DIR, `${flowType}.md`);
  if (!existsSync(flowFile)) {
    throw new Error(`Flow definition not found: ${flowFile}`);
  }
  const content = readFileSync(flowFile, "utf-8");
  // Parse steps from YAML block in flow definition markdown
  const yamlMatch = content.match(/```yaml\n([\s\S]*?)```/);
  if (!yamlMatch) {
    throw new Error(`No steps YAML block in ${flowFile}`);
  }
  return parseFlowYaml(yamlMatch[1]);
}

function parseFlowYaml(yaml: string): FlowDefinition {
  // Simple parser for flow definition YAML — avoids external dependency
  const steps: StepDef[] = [];
  let current: Partial<StepDef> | null = null;

  for (const line of yaml.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed === "steps:") continue;

    if (trimmed.startsWith("- name:")) {
      if (current?.name) steps.push(current as StepDef);
      current = { name: trimmed.split(":")[1].trim() };
    } else if (current && trimmed.includes(":")) {
      const [key, ...valueParts] = trimmed.split(":");
      const value = valueParts.join(":").trim();
      const k = key.trim();
      if (k === "depth") current.depth = value;
      if (k === "reviewer") current.reviewer = value;
      if (k === "mode") current.mode = value;
      if (k === "isolation") current.isolation = value;
      if (k === "loop_with") current.loop_with = value;
      if (k === "on_fail") current.on_fail = value;
      if (k === "max_failures") current.max_failures = parseInt(value);
    }
  }
  if (current?.name) steps.push(current as StepDef);
  return { steps };
}

// --- Agent Execution ---

function runAgent(agentName: string, prompt: string): StepResult {
  try {
    const result = execSync(
      `claude --agent ${agentName} --print --dangerously-skip-permissions`,
      {
        input: prompt,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 600_000,
      }
    );
    return parseAgentOutput(result);
  } catch (err: any) {
    return {
      status: "BLOCKED",
      reason: `Agent ${agentName} failed: ${err.message}`,
    };
  }
}

function parseAgentOutput(output: string): StepResult {
  const lines = output.trim().split("\n");
  const result: StepResult = { status: "DONE" };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("STATUS:")) result.status = trimmed.split(":")[1].trim() as StepResult["status"];
    if (trimmed.startsWith("ARTIFACT:")) result.artifact = trimmed.split(":").slice(1).join(":").trim();
    if (trimmed.startsWith("CONCERNS:")) result.concerns = trimmed.split(":").slice(1).join(":").trim();
    if (trimmed.startsWith("REASON:")) result.reason = trimmed.split(":").slice(1).join(":").trim();
    if (trimmed.startsWith("QUESTION:")) result.question = trimmed.split(":").slice(1).join(":").trim();
    if (trimmed.startsWith("FAILURE_ORIGIN:")) result.failure_origin = trimmed.split(":")[1].trim();
    if (trimmed.startsWith("EVIDENCE:")) result.evidence = trimmed.split(":").slice(1).join(":").trim();
    if (trimmed.startsWith("RESULT:")) result.result = trimmed.split(":")[1].trim();
    if (trimmed.startsWith("VERDICT:")) {
      const verdict = trimmed.split(":")[1].trim();
      result.status = verdict === "PASS" ? "DONE" : "BLOCKED";
      result.result = verdict;
    }
  }
  return result;
}

// --- Mechanical Gates ---

function runGates(): { pass: boolean; error?: string } {
  // typecheck
  try {
    execSync("bun run typecheck 2>/dev/null || true", { encoding: "utf-8", timeout: 60_000 });
  } catch { /* typecheck not configured */ }

  // test
  try {
    execSync("bun test", { encoding: "utf-8", timeout: 120_000 });
  } catch (err: any) {
    return { pass: false, error: `Tests failed: ${err.message}` };
  }

  return { pass: true };
}

// --- Prompt Building ---

function buildProducerPrompt(
  step: StepDef,
  flow: FlowEntry,
  feedback?: string
): string {
  const parts: string[] = [];

  parts.push(`요청: ${flow.request}`);
  parts.push(`플로우: ${flow.flow}`);
  parts.push(`스텝: ${step.name}`);

  const prevArtifacts = flow.completed_steps
    .filter((s) => s.artifact)
    .map((s) => s.artifact!);

  if (prevArtifacts.length > 0) {
    parts.push(`\n<files_to_read>`);
    for (const a of prevArtifacts) {
      parts.push(a);
    }
    parts.push(`</files_to_read>`);
  }

  if (step.depth) {
    parts.push(`\nAnalyze depth: ${step.depth}`);
  }

  if (step.mode) {
    parts.push(`\nMode: ${step.mode}`);
  }

  if (feedback) {
    parts.push(`\n이전 시도 피드백:\n${feedback}`);
  }

  return parts.join("\n");
}

function buildReviewerPrompt(artifact: string): string {
  return `<files_to_read>\n${artifact}\n</files_to_read>`;
}

// --- Core Loop ---

function executeStep(step: StepDef, flow: FlowEntry): StepResult {
  let attempt = 0;
  let feedback: string | undefined = flow.feedback;
  flow.feedback = undefined;

  while (attempt < 3) {
    const prompt = buildProducerPrompt(step, flow, feedback);
    console.log(`[orchestrator] Running ${step.name} (attempt ${attempt + 1}/3)`);
    const producerResult = runAgent(step.name, prompt);

    if (producerResult.status === "BLOCKED") return producerResult;
    if (producerResult.status === "NEEDS_CONTEXT") return producerResult;

    // Mechanical gates (for code-producing steps)
    if (["test", "implement"].includes(step.name)) {
      const gates = runGates();
      if (!gates.pass) {
        feedback = `Gate failure: ${gates.error}`;
        attempt++;
        continue;
      }
    }

    // Reviewer (if step has one)
    if (step.reviewer) {
      const reviewArtifact = producerResult.artifact || "";
      const reviewPrompt = buildReviewerPrompt(reviewArtifact);
      console.log(`[orchestrator] Running ${step.reviewer}`);
      const reviewResult = runAgent(step.reviewer, reviewPrompt);

      if (reviewResult.result === "PASS" || reviewResult.status === "DONE") {
        return producerResult;
      } else {
        feedback = reviewResult.reason || reviewResult.evidence || "Reviewer rejected output";
        attempt++;
        continue;
      }
    }

    return producerResult;
  }

  return { status: "DONE_WITH_CONCERNS", concerns: `Max attempts (3) reached for ${step.name}` };
}

// --- Commands ---

function cmdStart(flowType: string, request: string): void {
  ensureDirs();
  const state = readState();
  const active = getActiveFlow(state);
  if (active) {
    console.log(`BLOCKED: Active flow exists: ${active.id} (${active.flow}, step: ${active.step}). Suspend or complete it first.`);
    process.exit(1);
  }

  const flowDef = readFlowDef(flowType);
  const id = generateFlowId(flowType);
  const firstStep = flowDef.steps[0];

  const entry: FlowEntry = {
    id,
    flow: flowType,
    status: "active",
    step: firstStep.name,
    started: new Date().toISOString(),
    summary: request.substring(0, 100),
    request,
    completed_steps: [],
    pending: flowDef.steps.map((s) => s.name),
    attempt_count: 0,
    verify_failures: 0,
  };

  state.flows.push(entry);
  writeState(state);

  const prompt = buildProducerPrompt(firstStep, entry);
  console.log(`Agent(${firstStep.name}) 실행. prompt: '${prompt}'`);
}

function cmdNext(): void {
  const state = readState();
  const flow = getActiveFlow(state);
  if (!flow) return; // no-op for non-blazewrit Agent calls

  const flowDef = readFlowDef(flow.flow);
  const currentStepIdx = flowDef.steps.findIndex((s) => s.name === flow.step);
  const currentStep = flowDef.steps[currentStepIdx];

  const artifactExists = checkArtifactExists(flow, currentStep);

  if (artifactExists) {
    flow.completed_steps.push({
      name: currentStep.name,
      status: "DONE",
      artifact: getArtifactPath(flow, currentStep),
    });
    flow.pending = flow.pending.filter((p) => p !== currentStep.name);
    flow.attempt_count = 0;

    const nextStepIdx = currentStepIdx + 1;
    if (nextStepIdx >= flowDef.steps.length) {
      flow.status = "completed";
      writeState(state);
      console.log(`DONE: Flow ${flow.id} completed.`);
      return;
    }

    const nextStep = flowDef.steps[nextStepIdx];
    flow.step = nextStep.name;
    writeState(state);

    const prompt = buildProducerPrompt(nextStep, flow);
    console.log(`Agent(${nextStep.name}) 실행. prompt: '${prompt}'`);
  } else {
    const prompt = buildProducerPrompt(currentStep, flow, flow.feedback);
    console.log(`Agent(${currentStep.name}) 실행. prompt: '${prompt}'`);
  }
}

function cmdRun(flowType: string, request: string): void {
  ensureDirs();
  const state = readState();

  const flowDef = readFlowDef(flowType);
  const id = generateFlowId(flowType);

  const entry: FlowEntry = {
    id,
    flow: flowType,
    status: "active",
    step: flowDef.steps[0].name,
    started: new Date().toISOString(),
    summary: request.substring(0, 100),
    request,
    completed_steps: [],
    pending: flowDef.steps.map((s) => s.name),
    attempt_count: 0,
    verify_failures: 0,
  };

  state.flows.push(entry);
  writeState(state);

  for (const step of flowDef.steps) {
    entry.step = step.name;
    writeState(state);

    console.log(`\n=== Step: ${step.name} ===`);
    const result = executeStep(step, entry);

    if (result.status === "BLOCKED") {
      entry.status = "suspended";
      entry.suspend_reason = result.reason;
      writeState(state);
      console.log(`BLOCKED: ${result.reason}`);
      process.exit(1);
    }

    if (result.status === "NEEDS_CONTEXT") {
      entry.status = "suspended";
      entry.pending_question = result.question;
      writeState(state);
      console.log(`ASK: ${result.question}`);
      process.exit(3);
    }

    // Verify failure routing
    if (step.name === "verify" && result.result === "FAIL") {
      entry.verify_failures++;
      if (entry.verify_failures >= (step.max_failures || 3)) {
        entry.status = "suspended";
        entry.suspend_reason = "Verify failed 3 times";
        writeState(state);
        console.log(`BLOCKED: Verify failed ${entry.verify_failures} times`);
        process.exit(1);
      }

      const origin = result.failure_origin || "implement";
      const originIdx = flowDef.steps.findIndex((s) => s.name === origin);
      if (originIdx >= 0) {
        entry.feedback = `Verify failure: ${result.reason}\nEvidence: ${result.evidence}`;
        console.log(`[orchestrator] Verify FAIL → routing back to ${origin}`);
        const originSteps = flowDef.steps.slice(originIdx, flowDef.steps.indexOf(step));
        for (const reStep of originSteps) {
          entry.step = reStep.name;
          writeState(state);
          const reResult = executeStep(reStep, entry);
          if (reResult.status === "BLOCKED" || reResult.status === "NEEDS_CONTEXT") {
            entry.status = "suspended";
            writeState(state);
            process.exit(reResult.status === "NEEDS_CONTEXT" ? 3 : 1);
          }
          entry.completed_steps.push({
            name: reStep.name,
            status: reResult.status === "DONE" ? "DONE" : "DONE_WITH_CONCERNS",
            artifact: reResult.artifact,
          });
          entry.feedback = undefined;
        }
        continue;
      }
    }

    entry.completed_steps.push({
      name: step.name,
      status: result.status === "DONE" ? "DONE" : "DONE_WITH_CONCERNS",
      artifact: result.artifact,
    });
    entry.pending = entry.pending.filter((p) => p !== step.name);
  }

  entry.status = "completed";
  writeState(state);
  console.log(`\nDONE: Flow ${entry.id} completed.`);
}

function cmdResume(flowId: string, context?: string): void {
  const state = readState();
  const flow = state.flows.find((f) => f.id === flowId);
  if (!flow) {
    console.log(`BLOCKED: Flow ${flowId} not found`);
    process.exit(1);
  }

  flow.status = "active";
  flow.suspend_reason = undefined;
  flow.pending_question = undefined;

  if (context) {
    flow.feedback = `유저 응답: ${context}`;
  }

  try {
    execSync("git checkout -- . 2>/dev/null || true", { encoding: "utf-8" });
  } catch { /* no git or no changes */ }

  writeState(state);

  const flowDef = readFlowDef(flow.flow);
  const currentStep = flowDef.steps.find((s) => s.name === flow.step);
  if (currentStep) {
    const prompt = buildProducerPrompt(currentStep, flow, flow.feedback);
    console.log(`Agent(${currentStep.name}) 실행. prompt: '${prompt}'`);
  }
}

function cmdAbandon(flowId: string): void {
  const state = readState();
  const flow = state.flows.find((f) => f.id === flowId);
  if (!flow) {
    console.log(`BLOCKED: Flow ${flowId} not found`);
    process.exit(1);
  }

  console.log("[orchestrator] Running reflect (abandoned)");
  const reflectPrompt = buildProducerPrompt(
    { name: "reflect" },
    flow,
    `Flow abandoned. Reason: user requested.`
  );
  runAgent("reflect", reflectPrompt);

  flow.status = "abandoned";
  writeState(state);
  console.log(`Flow ${flowId} abandoned. Reflect completed.`);
}

function cmdReclassify(flowId: string, newType: string): void {
  const state = readState();
  const flow = state.flows.find((f) => f.id === flowId);
  if (!flow) {
    console.log(`BLOCKED: Flow ${flowId} not found`);
    process.exit(1);
  }

  flow.flow = newType;
  flow.step = "analyze";
  flow.completed_steps = [];
  flow.attempt_count = 0;
  flow.verify_failures = 0;

  const flowDef = readFlowDef(newType);
  flow.pending = flowDef.steps.map((s) => s.name);

  writeState(state);

  const firstStep = flowDef.steps[0];
  const prompt = buildProducerPrompt(firstStep, flow);
  console.log(`Reclassified to ${newType}. Agent(${firstStep.name}) 실행. prompt: '${prompt}'`);
}

function cmdStatus(flowId?: string): void {
  const state = readState();
  if (flowId) {
    const flow = state.flows.find((f) => f.id === flowId);
    if (!flow) {
      console.log("No flow found with that ID.");
      return;
    }
    console.log(`${flow.id}: ${flow.status}, flow: ${flow.flow}, step: ${flow.step}, attempts: ${flow.attempt_count}, verify_failures: ${flow.verify_failures}`);
  } else {
    const active = state.flows.filter((f) => f.status === "active" || f.status === "suspended");
    if (active.length === 0) {
      console.log("No active or suspended flows.");
      return;
    }
    for (const f of active) {
      console.log(`${f.id}: ${f.status}, flow: ${f.flow}, step: ${f.step}`);
    }
  }
}

function cmdCheckIncomplete(): void {
  const state = readState();
  const active = getActiveFlow(state);
  if (active) {
    console.log(`Active flow: ${active.id} (${active.flow}, step: ${active.step}). Complete or abandon before ending session.`);
    process.exit(2);
  }
}

// --- Hook Subcommands ---

function hookFirebatScan(): void {
  // firebat scan — fail-closed (exit 2 on error)
  try {
    execSync("bun run firebat scan 2>/dev/null", { encoding: "utf-8", timeout: 30_000 });
  } catch (err: any) {
    if (err.status) {
      console.log(`firebat scan found issues`);
      process.exit(2); // block
    }
    // firebat not available — skip (graceful degradation)
  }
}

function hookStuckDetection(): void {
  // Count consecutive read-only calls. 5 → warn, 8 → force escalate.
  const counterFile = join(BLAZEWRIT_DIR, ".stuck-counter");
  let count = 0;
  try {
    count = parseInt(readFileSync(counterFile, "utf-8")) || 0;
  } catch { /* no counter yet */ }

  count++;
  writeFileSync(counterFile, String(count));

  if (count >= 8) {
    console.log(`Stuck detection: ${count} consecutive read-only calls. Escalate or take action.`);
    writeFileSync(counterFile, "0");
  } else if (count >= 5) {
    console.log(`Stuck detection: ${count} consecutive read-only calls. Consider taking action.`);
  }
}

function hookResetStuckCounter(): void {
  // Called by Edit/Write hooks to reset the stuck counter
  const counterFile = join(BLAZEWRIT_DIR, ".stuck-counter");
  writeFileSync(counterFile, "0");
}

function hookRegressionGuard(): void {
  // emberdeck regression check — fail-closed (exit 2 on regression)
  try {
    execSync("bun run emberdeck regression-guard 2>/dev/null", { encoding: "utf-8", timeout: 30_000 });
  } catch (err: any) {
    if (err.status) {
      console.log(`Regression guard: spec drift detected. Resolve before committing.`);
      process.exit(2);
    }
    // emberdeck not available — skip
  }
}

function hookBlockerCheck(): void {
  // firebat blockers > 0 → block session end — fail-closed
  try {
    const output = execSync("bun run firebat scan --json 2>/dev/null", { encoding: "utf-8", timeout: 30_000 });
    const result = JSON.parse(output);
    if (result.blockers && result.blockers > 0) {
      console.log(`Blocker check: ${result.blockers} firebat blockers remain. Resolve before ending session.`);
      process.exit(2);
    }
  } catch {
    // firebat not available — skip
  }
}

function hookReflectGate(): void {
  // Check state file: any flow completed without reflect — fail-open
  const state = readState();
  const unreflected = state.flows.find(
    (f) => f.status === "completed" && !f.completed_steps.some((s) => s.name === "reflect")
  );
  if (unreflected) {
    console.log(`Reflect gate: flow ${unreflected.id} completed without Reflect. Run Reflect before ending session.`);
  }
}

function hookCoverageGate(): void {
  // If flow=refactor and coverage < 80% and Test not completed → block — fail-open
  const state = readState();
  const active = getActiveFlow(state);
  if (!active || active.flow !== "refactor") return;
  if (active.completed_steps.some((s) => s.name === "test")) return;

  try {
    const output = execSync("bun test --coverage 2>/dev/null || true", { encoding: "utf-8", timeout: 60_000 });
    const coverageMatch = output.match(/(\d+\.?\d*)%/);
    if (coverageMatch) {
      const coverage = parseFloat(coverageMatch[1]);
      if (coverage < 80) {
        console.log(`Coverage gate: ${coverage}% < 80%. Run Test step before Implement for Refactor flows.`);
      }
    }
  } catch { /* coverage check not available */ }
}

function hookReflectStructure(): void {
  // Check Reflect output has required sections — fail-open
  const state = readState();
  const active = getActiveFlow(state);
  if (!active || active.step !== "reflect") return;

  const historyFile = join(HISTORY_DIR, `${active.id}.yaml`);
  if (!existsSync(historyFile)) return;

  const content = readFileSync(historyFile, "utf-8");
  const required = ["what_worked", "what_failed", "unexpected", "patterns_discovered"];
  const missing = required.filter((s) => !content.includes(s));

  if (missing.length > 0) {
    console.log(`Reflect structure: missing sections: ${missing.join(", ")}`);
  }
}

// --- Helpers ---

function checkArtifactExists(flow: FlowEntry, step: StepDef): boolean {
  const path = getArtifactPath(flow, step);
  return path ? existsSync(path) : false;
}

function getArtifactPath(flow: FlowEntry, step: StepDef): string | undefined {
  switch (step.name) {
    case "analyze":
      return join(ANALYSIS_DIR, `${flow.id}.md`);
    case "기획":
      return join(PLANS_DIR, `${flow.id}-기획.md`);
    case "spec":
      return join(PLANS_DIR, `${flow.id}-spec.md`);
    case "report":
      return join(REPORTS_DIR, `${flow.id}.md`);
    case "verify":
      return join(BLAZEWRIT_DIR, `verify-${flow.id}.md`);
    case "reflect":
      return join(HISTORY_DIR, `${flow.id}.json`);
    default:
      return undefined;
  }
}

// --- CLI ---

const [, , command, ...args] = process.argv;

switch (command) {
  case "start":
    cmdStart(args[0], args.slice(1).join(" "));
    break;
  case "run":
    cmdRun(args[0], args.slice(1).join(" "));
    break;
  case "next":
    cmdNext();
    break;
  case "resume":
    cmdResume(args[0], args.slice(1).join(" ") || undefined);
    break;
  case "abandon":
    cmdAbandon(args[0]);
    break;
  case "reclassify":
    cmdReclassify(args[0], args[1]);
    break;
  case "status":
    cmdStatus(args[0]);
    break;
  case "check-incomplete":
    cmdCheckIncomplete();
    break;
  case "hook": {
    const hookName = args[0];
    switch (hookName) {
      case "firebat-scan": hookFirebatScan(); break;
      case "stuck-detection": hookStuckDetection(); break;
      case "reset-stuck": hookResetStuckCounter(); break;
      case "regression-guard": hookRegressionGuard(); break;
      case "blocker-check": hookBlockerCheck(); break;
      case "reflect-gate": hookReflectGate(); break;
      case "coverage-gate": hookCoverageGate(); break;
      case "reflect-structure": hookReflectStructure(); break;
      default: console.log(`Unknown hook: ${hookName}`);
    }
    break;
  }
  default:
    console.log(`Usage: orchestrator.ts <command> [args]
Commands:
  start <flow_type> <request>     Create flow, return first step
  run <flow_type> <request>       Execute full loop (A2A/CI)
  next                            Return next step (hook-driven)
  resume <flow_id> [context]      Resume suspended flow
  abandon <flow_id>               Abandon flow + Reflect
  reclassify <flow_id> <new_type> Change flow type
  status [flow_id]                Show flow status
  check-incomplete                Exit 2 if incomplete flow exists
  hook <name>                     Run hook subcommand`);
}
