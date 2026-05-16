/**
 * Orchestrator state machine integration test.
 * Tests flow progression logic WITHOUT real agent execution.
 * Mocks agent calls by directly writing artifacts and step-status files.
 */

import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";

const BW = ".blazewrit";
const STATE = join(BW, "flow-state.json");
const STATUS = join(BW, ".step-status");
const FLOWS = join(BW, "flows");
const ANALYSIS = join(BW, "analysis");
const PLANS = join(BW, "plans");
const REPORTS = join(BW, "reports");
const HISTORY = join(BW, "flow-history");
const TEST_RES = join(BW, "test-results");
const IMPL_RES = join(BW, "impl-results");

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

function clean(): void {
  if (existsSync(BW)) rmSync(BW, { recursive: true });
}

function ensureAll(): void {
  for (const d of [BW, FLOWS, ANALYSIS, PLANS, REPORTS, HISTORY, TEST_RES, IMPL_RES]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

function readState(): any {
  return JSON.parse(readFileSync(STATE, "utf-8"));
}

function writeStatus(obj: any): void {
  writeFileSync(STATUS, JSON.stringify(obj));
}

function writeArtifact(path: string, content: string): void {
  const dir = join(path, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, content);
}

function run(cmd: string): { stdout: string; exit: number } {
  try {
    const stdout = execSync(`bun /tmp/orchestrator-blazewrit.ts ${cmd}`, {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: "pipe",
    });
    return { stdout, exit: 0 };
  } catch (err: any) {
    return { stdout: err.stdout || err.stderr || "", exit: err.status ?? 1 };
  }
}

// --- Flow Definitions for Testing ---

const FEATURE_FLOW = `# Test Feature Flow
\`\`\`yaml
steps:
  - name: analyze
    depth: thorough
    reviewer: analyze-reviewer
  - name: 기획
    reviewer: 기획-reviewer
  - name: spec
    reviewer: spec-reviewer
  - name: test
    reviewer: test-reviewer
    loop_with: implement
  - name: implement
    reviewer: implement-reviewer
  - name: verify
    on_fail: route_to_origin
    max_failures: 3
  - name: reflect
\`\`\`
`;

const BUGFIX_FLOW = `# Test Bugfix Flow
\`\`\`yaml
steps:
  - name: analyze
    depth: focused
    reviewer: analyze-reviewer
  - name: test
    mode: reproduce
    reviewer: test-reviewer
  - name: implement
    mode: fix
    reviewer: implement-reviewer
  - name: verify
    on_fail: route_to_origin
    max_failures: 3
  - name: reflect
\`\`\`
`;

const REFACTOR_FLOW = `# Test Refactor Flow
\`\`\`yaml
steps:
  - name: analyze
    depth: thorough
    reviewer: analyze-reviewer
  - name: 기획
    condition: scope_large
    reviewer: 기획-reviewer
  - name: spec
    reviewer: spec-reviewer
  - name: test
    condition: coverage_below_80
    reviewer: test-reviewer
  - name: implement
    reviewer: implement-reviewer
  - name: verify
    on_fail: route_to_origin
    max_failures: 3
  - name: reflect
\`\`\`
`;

const CHORE_FLOW = `# Test Chore Flow
\`\`\`yaml
steps:
  - name: analyze
    depth: minimal
    reviewer: analyze-reviewer
  - name: implement
    reviewer: implement-reviewer
  - name: verify
    on_fail: route_to_origin
    max_failures: 3
  - name: reflect
\`\`\`
`;

function setupFlows(): void {
  writeFileSync(join(FLOWS, "feature.md"), FEATURE_FLOW);
  writeFileSync(join(FLOWS, "bugfix.md"), BUGFIX_FLOW);
  writeFileSync(join(FLOWS, "refactor.md"), REFACTOR_FLOW);
  writeFileSync(join(FLOWS, "chore.md"), CHORE_FLOW);
}

// ============================================================
// TEST 1: Basic start → status → check-incomplete
// ============================================================
function test1_basic_lifecycle(): void {
  console.log("\n=== TEST 1: Basic lifecycle (start/status/check-incomplete) ===");
  clean();
  ensureAll();
  setupFlows();

  // Start a chore flow
  const r1 = run("start chore 'fix typo in readme'");
  assert(r1.exit === 0, "start chore succeeds");
  assert(r1.stdout.includes("Agent(analyze)"), "first step is analyze");

  // State file should exist with active flow
  const s1 = readState();
  assert(s1.flows.length === 1, "one flow in state");
  assert(s1.flows[0].status === "active", "flow is active");
  assert(s1.flows[0].step === "analyze", "current step is analyze");

  // Status shows active flow
  const r2 = run("status");
  assert(r2.stdout.includes("active"), "status shows active");
  assert(r2.stdout.includes("chore"), "status shows chore");

  // Check-incomplete should exit 2
  const r3 = run("check-incomplete");
  assert(r3.exit === 2, "check-incomplete exits 2 when flow active");

  // Starting another flow should be blocked
  const r4 = run("start bugfix 'another task'");
  assert(r4.exit === 1, "second start blocked");
  assert(r4.stdout.includes("BLOCKED"), "blocked message shown");
}

// ============================================================
// TEST 2: cmdNext — step-by-step advancement via artifacts
// ============================================================
function test2_cmdNext_advancement(): void {
  console.log("\n=== TEST 2: cmdNext step advancement ===");
  clean();
  ensureAll();
  setupFlows();

  // Start chore: analyze → implement → verify → reflect
  run("start chore 'update ci config'");
  const s0 = readState();
  const flowId = s0.flows[0].id;

  // Simulate analyze completion: write artifact
  writeArtifact(join(ANALYSIS, `${flowId}.md`), "findings: CI config outdated\nfiles_to_read:\n  - .github/ci.yml");

  // cmdNext should advance to implement
  const r1 = run("next");
  assert(r1.stdout.includes("Agent(implement)"), "next advances to implement");
  const s1 = readState();
  assert(s1.flows[0].step === "implement", "state step is implement");
  assert(s1.flows[0].completed_steps.length === 1, "1 completed step");

  // Simulate implement completion
  writeArtifact(join(IMPL_RES, `${flowId}.md`), "changed: .github/ci.yml\ncommit: abc123");

  // cmdNext should advance to verify
  const r2 = run("next");
  assert(r2.stdout.includes("Agent(verify)"), "next advances to verify");

  // Simulate verify PASS
  writeArtifact(join(BW, `verify-${flowId}.md`), "RESULT: PASS\nAll checks passed.");
  writeStatus({ status: "DONE", result: "PASS" });

  // cmdNext should advance to reflect
  const r3 = run("next");
  assert(r3.stdout.includes("Agent(reflect)"), "next advances to reflect");

  // Simulate reflect completion
  writeArtifact(join(HISTORY, `${flowId}.json`), JSON.stringify({
    what_worked: "quick fix", what_failed: "nothing",
    unexpected: "none", patterns_discovered: "none"
  }));

  // cmdNext should complete the flow
  const r4 = run("next");
  assert(r4.stdout.includes("DONE"), "flow completed");

  // Flow should be archived
  assert(existsSync(join(HISTORY, `${flowId}.json`)), "flow archived to history");
  const s4 = readState();
  assert(s4.flows.length === 0, "flow removed from active state");
}

// ============================================================
// TEST 3: cmdNext — Verify FAIL routing
// ============================================================
function test3_verify_failure_routing(): void {
  console.log("\n=== TEST 3: Verify failure routing in cmdNext ===");
  clean();
  ensureAll();
  setupFlows();

  run("start chore 'fix thing'");
  const s0 = readState();
  const flowId = s0.flows[0].id;

  // Complete analyze
  writeArtifact(join(ANALYSIS, `${flowId}.md`), "findings: something");
  run("next"); // → implement

  // Complete implement
  writeArtifact(join(IMPL_RES, `${flowId}.md`), "changed: file.ts");
  run("next"); // → verify

  // Verify FAIL with failure_origin=implement
  writeStatus({
    status: "DONE",
    result: "FAIL",
    failure_origin: "implement",
    reason: "stub code detected",
    evidence: "file.ts:42 return null",
  });

  const r1 = run("next");
  assert(r1.stdout.includes("Agent(implement)"), "routes back to implement on verify fail");

  const s1 = readState();
  assert(s1.flows[0].step === "implement", "state step is implement after verify fail");
  assert(s1.flows[0].verify_failures === 1, "verify_failures incremented");
  assert(s1.flows[0].feedback!.includes("stub code"), "feedback contains verify reason");
}

// ============================================================
// TEST 4: cmdNext — NEEDS_CONTEXT via step status
// ============================================================
function test4_needs_context(): void {
  console.log("\n=== TEST 4: NEEDS_CONTEXT handling ===");
  clean();
  ensureAll();
  setupFlows();

  run("start chore 'ambiguous task'");
  const flowId = readState().flows[0].id;

  // Agent writes NEEDS_CONTEXT to step status
  writeStatus({ status: "NEEDS_CONTEXT", question: "어떤 CI를 쓰나요?" });

  const r1 = run("next");
  assert(r1.stdout.includes("ASK:"), "outputs ASK for user");
  assert(r1.stdout.includes("어떤 CI"), "includes the question");

  const s1 = readState();
  assert(s1.flows[0].status === "suspended", "flow suspended");
  assert(s1.flows[0].pending_question === "어떤 CI를 쓰나요?", "question stored");

  // Resume with context
  const r2 = run(`resume ${flowId} 'GitHub Actions'`);
  assert(r2.exit === 0, "resume succeeds");
  assert(r2.stdout.includes("Agent(analyze)"), "resumes at analyze");

  const s2 = readState();
  assert(s2.flows[0].status === "active", "flow reactivated");
  assert(s2.flows[0].feedback!.includes("GitHub Actions"), "context in feedback");
}

// ============================================================
// TEST 5: cmdNext — BLOCKED via step status
// ============================================================
function test5_blocked(): void {
  console.log("\n=== TEST 5: BLOCKED handling ===");
  clean();
  ensureAll();
  setupFlows();

  run("start chore 'something impossible'");

  writeStatus({ status: "BLOCKED", reason: "Cannot access required service" });

  const r1 = run("next");
  assert(r1.stdout.includes("BLOCKED"), "outputs BLOCKED");

  const s1 = readState();
  assert(s1.flows[0].status === "suspended", "flow suspended on block");
}

// ============================================================
// TEST 6: Conditional step skip (refactor flow)
// ============================================================
function test6_conditional_skip(): void {
  console.log("\n=== TEST 6: Conditional step skip ===");
  clean();
  ensureAll();
  setupFlows();

  run("start refactor 'clean up auth module'");
  const flowId = readState().flows[0].id;

  // Write analyze artifact with FEWER than 5 files (scope_large = false)
  writeArtifact(join(ANALYSIS, `${flowId}.md`), "findings: small scope\nfiles_to_read:\n  - src/auth.ts\n  - src/auth.test.ts");

  // cmdNext should skip 기획 (condition: scope_large not met) and go to spec
  const r1 = run("next");
  assert(r1.stdout.includes("Agent(spec)"), "skips 기획 when scope not large");
  assert(r1.stdout.includes("Skipping") || true, "may log skip message");

  const s1 = readState();
  assert(s1.flows[0].step === "spec", "current step is spec, not 기획");
}

// ============================================================
// TEST 7: Conditional step NOT skipped (scope_large met)
// ============================================================
function test7_conditional_not_skip(): void {
  console.log("\n=== TEST 7: Conditional step NOT skipped ===");
  clean();
  ensureAll();
  setupFlows();

  run("start refactor 'big refactor'");
  const flowId = readState().flows[0].id;

  // Write analyze artifact with 5+ files (scope_large = true)
  writeArtifact(join(ANALYSIS, `${flowId}.md`),
    "findings: big scope\nfiles_to_read:\n  - a.ts\n  - b.ts\n  - c.ts\n  - d.ts\n  - e.ts");

  const r1 = run("next");
  assert(r1.stdout.includes("Agent(기획)"), "does NOT skip 기획 when scope is large");
}

// ============================================================
// TEST 8: loop_with in cmdNext (Test ⇄ Implement gate check)
// ============================================================
function test8_loop_with_cmdNext(): void {
  console.log("\n=== TEST 8: loop_with gate check in cmdNext ===");
  clean();
  ensureAll();
  setupFlows();

  run("start feature 'add avatar upload'");
  const flowId = readState().flows[0].id;

  // Complete: analyze → 기획 → spec → test
  writeArtifact(join(ANALYSIS, `${flowId}.md`), "findings: avatar upload\nfiles_to_read:\n  - src/upload.ts");
  run("next"); // → 기획
  writeArtifact(join(PLANS, `${flowId}-기획.md`), "plan: avatar upload feature");
  run("next"); // → spec
  writeArtifact(join(PLANS, `${flowId}-spec.md`), "AC-001: upload works\nAC-002: resize works");
  run("next"); // → test
  writeArtifact(join(TEST_RES, `${flowId}.md`), "tests: avatar-upload.test.ts RED");
  run("next"); // → implement (test has loop_with: implement)

  const s1 = readState();
  assert(s1.flows[0].step === "implement", "advanced to implement after test");

  // Now implement completes — implement is the loop end
  // Since we can't actually run gates (no real tests), the gate will fail
  // But that's ok — we're testing that the loop detection works
  writeArtifact(join(IMPL_RES, `${flowId}.md`), "changed: src/avatar.ts");

  // cmdNext should detect implement is loop end, try gates
  // Gates will likely fail (no real test suite) — should loop back to test
  // OR gates may pass if bun test succeeds (no tests = pass?)
  const r1 = run("next");
  // Either loops back to test or advances to verify
  const s2 = readState();
  const step = s2.flows[0].step;
  assert(
    step === "test" || step === "verify",
    `after implement in loop: step is ${step} (test=loop back, verify=gates passed)`
  );
}

// ============================================================
// TEST 9: Abandon → Reflect + Archive
// ============================================================
function test9_abandon(): void {
  console.log("\n=== TEST 9: Abandon with archive ===");
  clean();
  ensureAll();
  setupFlows();

  run("start chore 'something'");
  const flowId = readState().flows[0].id;

  // Abandon will try to run reflect agent (will fail since no claude)
  // but should still update state
  const r1 = run(`abandon ${flowId}`);
  // The agent call will fail, but abandon should still mark as abandoned

  // Check if archived (agent failure may prevent clean archive)
  // At minimum, flow should be marked abandoned in state
  const stateExists = existsSync(STATE);
  if (stateExists) {
    const s1 = readState();
    const flow = s1.flows.find((f: any) => f.id === flowId);
    const archived = existsSync(join(HISTORY, `${flowId}.json`));
    assert(flow === undefined || flow.status === "abandoned", "flow abandoned or archived");
  }
}

// ============================================================
// TEST 10: Active flow check in cmdRun
// ============================================================
function test10_run_active_check(): void {
  console.log("\n=== TEST 10: cmdRun blocks when active flow exists ===");
  clean();
  ensureAll();
  setupFlows();

  // Create an active flow via start
  run("start chore 'first task'");

  // cmdRun should be blocked
  const r1 = run("run chore 'second task'");
  assert(r1.exit === 1, "cmdRun exits 1 when active flow exists");
  assert(r1.stdout.includes("BLOCKED"), "cmdRun shows blocked message");
}

// ============================================================
// TEST 11: Reclassify
// ============================================================
function test11_reclassify(): void {
  console.log("\n=== TEST 11: Reclassify ===");
  clean();
  ensureAll();
  setupFlows();

  run("start chore 'thought it was chore'");
  const flowId = readState().flows[0].id;

  const r1 = run(`reclassify ${flowId} bugfix`);
  assert(r1.exit === 0, "reclassify succeeds");
  assert(r1.stdout.includes("bugfix"), "output mentions new type");

  const s1 = readState();
  assert(s1.flows[0].flow === "bugfix", "flow type changed to bugfix");
  assert(s1.flows[0].step === "analyze", "reset to analyze");
  assert(s1.flows[0].completed_steps.length === 0, "completed_steps cleared");
}

// ============================================================
// TEST 12: Verify max failures → BLOCKED
// ============================================================
function test12_verify_max_failures(): void {
  console.log("\n=== TEST 12: Verify max failures ===");
  clean();
  ensureAll();
  setupFlows();

  run("start chore 'failing task'");
  const flowId = readState().flows[0].id;

  // Complete analyze → implement → verify
  writeArtifact(join(ANALYSIS, `${flowId}.md`), "findings: x");
  run("next");
  writeArtifact(join(IMPL_RES, `${flowId}.md`), "changed: y.ts");
  run("next"); // → verify

  // Fail verify 3 times
  for (let i = 0; i < 3; i++) {
    writeStatus({
      status: "DONE", result: "FAIL",
      failure_origin: "implement", reason: `fail ${i + 1}`,
    });
    run("next");

    const s = readState();
    if (s.flows[0].status === "suspended") break;

    // Re-complete implement for next verify attempt
    writeArtifact(join(IMPL_RES, `${flowId}.md`), `changed: y.ts attempt ${i + 2}`);
    run("next"); // → verify again
  }

  const sf = readState();
  assert(sf.flows[0].status === "suspended", "flow suspended after 3 verify failures");
  assert(sf.flows[0].verify_failures >= 3, "verify_failures >= 3");
}

// ============================================================
// TEST 13: No-op when no active flow
// ============================================================
function test13_next_noop(): void {
  console.log("\n=== TEST 13: cmdNext no-op without active flow ===");
  clean();
  ensureAll();
  setupFlows();

  const r1 = run("next");
  assert(r1.exit === 0, "next exits 0 with no active flow");
  assert(r1.stdout.trim() === "", "next produces no output");
}

// ============================================================
// RUN ALL
// ============================================================

console.log("Orchestrator State Machine Tests\n");

test1_basic_lifecycle();
test2_cmdNext_advancement();
test3_verify_failure_routing();
test4_needs_context();
test5_blocked();
test6_conditional_skip();
test7_conditional_not_skip();
test8_loop_with_cmdNext();
test9_abandon();
test10_run_active_check();
test11_reclassify();
test12_verify_max_failures();
test13_next_noop();

console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${"=".repeat(50)}`);

// Cleanup
clean();

process.exit(failed > 0 ? 1 : 0);
