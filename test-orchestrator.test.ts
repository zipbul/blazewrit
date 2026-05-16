/**
 * Orchestrator state machine integration test.
 * Tests flow progression logic WITHOUT real agent execution.
 * Mocks agent calls by directly writing artifacts and step-status files.
 */

import { describe, test, expect, beforeEach } from "bun:test";
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
    const stdout = execSync(`bun src/orchestrator.ts ${cmd}`, {
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

function setup(): void {
  clean();
  ensureAll();
  setupFlows();
}

// ============================================================

describe("Orchestrator State Machine", () => {
  beforeEach(setup);

  describe("TEST 1: Basic lifecycle (start/status/check-incomplete)", () => {
    test("start chore succeeds and sets first step to analyze", () => {
      const r1 = run("start chore 'fix typo in readme'");
      expect(r1.exit).toBe(0);
      expect(r1.stdout).toContain("Agent(analyze)");

      const s1 = readState();
      expect(s1.flows).toHaveLength(1);
      expect(s1.flows[0].status).toBe("active");
      expect(s1.flows[0].step).toBe("analyze");
    });

    test("status shows active chore flow", () => {
      run("start chore 'fix typo in readme'");
      const r2 = run("status");
      expect(r2.stdout).toContain("active");
      expect(r2.stdout).toContain("chore");
    });

    test("check-incomplete exits 2 when flow active", () => {
      run("start chore 'fix typo in readme'");
      const r3 = run("check-incomplete");
      expect(r3.exit).toBe(2);
    });

    test("second start is blocked", () => {
      run("start chore 'fix typo in readme'");
      const r4 = run("start bugfix 'another task'");
      expect(r4.exit).toBe(1);
      expect(r4.stdout).toContain("BLOCKED");
    });
  });

  describe("TEST 2: cmdNext step advancement", () => {
    test("advances through chore flow: analyze → implement → verify → reflect → DONE", () => {
      run("start chore 'update ci config'");
      const s0 = readState();
      const flowId = s0.flows[0].id;

      // Simulate analyze completion
      writeArtifact(join(ANALYSIS, `${flowId}.md`), "findings: CI config outdated\nfiles_to_read:\n  - .github/ci.yml");

      // cmdNext should advance to implement
      const r1 = run("next");
      expect(r1.stdout).toContain("Agent(implement)");
      const s1 = readState();
      expect(s1.flows[0].step).toBe("implement");
      expect(s1.flows[0].completed_steps).toHaveLength(1);

      // Simulate implement completion
      writeArtifact(join(IMPL_RES, `${flowId}.md`), "changed: .github/ci.yml\ncommit: abc123");

      // cmdNext should advance to verify
      const r2 = run("next");
      expect(r2.stdout).toContain("Agent(verify)");

      // Simulate verify PASS
      writeArtifact(join(BW, `verify-${flowId}.md`), "RESULT: PASS\nAll checks passed.");
      writeStatus({ status: "DONE", result: "PASS" });

      // cmdNext should advance to reflect
      const r3 = run("next");
      expect(r3.stdout).toContain("Agent(reflect)");

      // Simulate reflect completion
      writeArtifact(join(HISTORY, `${flowId}.json`), JSON.stringify({
        what_worked: "quick fix", what_failed: "nothing",
        unexpected: "none", patterns_discovered: "none"
      }));

      // cmdNext should complete the flow
      const r4 = run("next");
      expect(r4.stdout).toContain("DONE");

      expect(existsSync(join(HISTORY, `${flowId}.json`))).toBe(true);
      const s4 = readState();
      expect(s4.flows).toHaveLength(0);
    });
  });

  describe("TEST 3: Verify failure routing in cmdNext", () => {
    test("routes back to implement on verify fail", () => {
      run("start chore 'fix thing'");
      const flowId = readState().flows[0].id;

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
      expect(r1.stdout).toContain("Agent(implement)");

      const s1 = readState();
      expect(s1.flows[0].step).toBe("implement");
      expect(s1.flows[0].verify_failures).toBe(1);
      expect(s1.flows[0].feedback).toContain("stub code");
    });
  });

  describe("TEST 4: NEEDS_CONTEXT handling", () => {
    test("suspends flow and stores question on NEEDS_CONTEXT", () => {
      run("start chore 'ambiguous task'");
      const flowId = readState().flows[0].id;

      writeStatus({ status: "NEEDS_CONTEXT", question: "어떤 CI를 쓰나요?" });

      const r1 = run("next");
      expect(r1.stdout).toContain("ASK:");
      expect(r1.stdout).toContain("어떤 CI");

      const s1 = readState();
      expect(s1.flows[0].status).toBe("suspended");
      expect(s1.flows[0].pending_question).toBe("어떤 CI를 쓰나요?");
    });

    test("resume reactivates flow with context", () => {
      run("start chore 'ambiguous task'");
      const flowId = readState().flows[0].id;

      writeStatus({ status: "NEEDS_CONTEXT", question: "어떤 CI를 쓰나요?" });
      run("next");

      const r2 = run(`resume ${flowId} 'GitHub Actions'`);
      expect(r2.exit).toBe(0);
      expect(r2.stdout).toContain("Agent(analyze)");

      const s2 = readState();
      expect(s2.flows[0].status).toBe("active");
      expect(s2.flows[0].feedback).toContain("GitHub Actions");
    });
  });

  describe("TEST 5: BLOCKED handling", () => {
    test("suspends flow on BLOCKED status", () => {
      run("start chore 'something impossible'");

      writeStatus({ status: "BLOCKED", reason: "Cannot access required service" });

      const r1 = run("next");
      expect(r1.stdout).toContain("BLOCKED");

      const s1 = readState();
      expect(s1.flows[0].status).toBe("suspended");
    });
  });

  describe("TEST 6: Conditional step skip", () => {
    test("skips 기획 when scope is not large", () => {
      run("start refactor 'clean up auth module'");
      const flowId = readState().flows[0].id;

      // Write analyze artifact with FEWER than 5 files
      writeArtifact(join(ANALYSIS, `${flowId}.md`), "findings: small scope\nfiles_to_read:\n  - src/auth.ts\n  - src/auth.test.ts");

      const r1 = run("next");
      expect(r1.stdout).toContain("Agent(spec)");

      const s1 = readState();
      expect(s1.flows[0].step).toBe("spec");
    });
  });

  describe("TEST 7: Conditional step NOT skipped", () => {
    test("does NOT skip 기획 when scope is large", () => {
      run("start refactor 'big refactor'");
      const flowId = readState().flows[0].id;

      // Write analyze artifact with 5+ files
      writeArtifact(join(ANALYSIS, `${flowId}.md`),
        "findings: big scope\nfiles_to_read:\n  - a.ts\n  - b.ts\n  - c.ts\n  - d.ts\n  - e.ts");

      const r1 = run("next");
      expect(r1.stdout).toContain("Agent(기획)");
    });
  });

  describe("TEST 8: loop_with gate check in cmdNext", () => {
    test("handles test ⇄ implement loop", () => {
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
      run("next"); // → implement

      const s1 = readState();
      expect(s1.flows[0].step).toBe("implement");

      // Now implement completes
      writeArtifact(join(IMPL_RES, `${flowId}.md`), "changed: src/avatar.ts");

      const r1 = run("next");
      const s2 = readState();
      const step = s2.flows[0].step;
      // Either loops back to test or advances to verify
      expect(step === "test" || step === "verify").toBe(true);
    });
  });

  describe("TEST 9: Abandon with archive", () => {
    test("marks flow as abandoned", () => {
      run("start chore 'something'");
      const flowId = readState().flows[0].id;

      // abandon calls runAgent("reflect") which will fail (no claude binary)
      // but should still mark flow as abandoned and archive it
      run(`abandon ${flowId}`);

      // Flow should be archived (removed from state) or marked abandoned
      const s1 = readState();
      const flow = s1.flows.find((f: any) => f.id === flowId);
      const archived = existsSync(join(HISTORY, `${flowId}.json`));
      expect(flow === undefined || flow.status === "abandoned" || archived).toBe(true);
    }, 15_000);
  });

  describe("TEST 10: cmdRun blocks when active flow exists", () => {
    test("cmdRun exits 1 with BLOCKED message", () => {
      run("start chore 'first task'");

      const r1 = run("run chore 'second task'");
      expect(r1.exit).toBe(1);
      expect(r1.stdout).toContain("BLOCKED");
    });
  });

  describe("TEST 11: Reclassify", () => {
    test("changes flow type and resets to analyze", () => {
      run("start chore 'thought it was chore'");
      const flowId = readState().flows[0].id;

      const r1 = run(`reclassify ${flowId} bugfix`);
      expect(r1.exit).toBe(0);
      expect(r1.stdout).toContain("bugfix");

      const s1 = readState();
      expect(s1.flows[0].flow).toBe("bugfix");
      expect(s1.flows[0].step).toBe("analyze");
      expect(s1.flows[0].completed_steps).toHaveLength(0);
    });
  });

  describe("TEST 12: Verify max failures", () => {
    test("suspends flow after 3 verify failures", () => {
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

        writeArtifact(join(IMPL_RES, `${flowId}.md`), `changed: y.ts attempt ${i + 2}`);
        run("next"); // → verify again
      }

      const sf = readState();
      expect(sf.flows[0].status).toBe("suspended");
      expect(sf.flows[0].verify_failures).toBeGreaterThanOrEqual(3);
    });
  });

  describe("TEST 13: cmdNext no-op without active flow", () => {
    test("exits 0 with no output", () => {
      const r1 = run("next");
      expect(r1.exit).toBe(0);
      expect(r1.stdout.trim()).toBe("");
    });
  });
});

// Cleanup after all tests
process.on("exit", () => {
  clean();
});
