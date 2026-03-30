#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PackageManager = "bun" | "npm" | "yarn" | "pnpm";
type CodingTool = "claude" | "cursor" | "copilot" | "gemini" | "fallback";

interface StepFile {
  name: string;
  description: string;
  allowedTools: string;
  body: string;
  raw: string; // full file content (frontmatter + body)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Resolve package root (two levels up from dist/bin/) */
function packageRoot(): string {
  return resolve(__dirname, "..", "..");
}

function log(msg: string): void {
  console.log(`  ${msg}`);
}

function heading(msg: string): void {
  console.log(`\n▸ ${msg}`);
}

// ---------------------------------------------------------------------------
// detectPackageManager
// ---------------------------------------------------------------------------

function detectPackageManager(cwd: string): PackageManager {
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) return "bun";
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

// ---------------------------------------------------------------------------
// installDevDeps
// ---------------------------------------------------------------------------

const DEV_DEPS = [
  "husky",
  "lint-staged",
  "@commitlint/cli",
  "@commitlint/config-conventional",
];

function installDevDeps(cwd: string, pm: PackageManager): void {
  heading("Installing dev dependencies");

  const addCmd: Record<PackageManager, string> = {
    bun: `bun add -d ${DEV_DEPS.join(" ")}`,
    npm: `npm install -D ${DEV_DEPS.join(" ")}`,
    yarn: `yarn add -D ${DEV_DEPS.join(" ")}`,
    pnpm: `pnpm add -D ${DEV_DEPS.join(" ")}`,
  };

  log(addCmd[pm]);
  execSync(addCmd[pm], { cwd, stdio: "inherit" });
}

// ---------------------------------------------------------------------------
// setupHusky
// ---------------------------------------------------------------------------

function setupHusky(cwd: string, pm: PackageManager): void {
  heading("Setting up Husky");

  const exec = (cmd: string) => execSync(cmd, { cwd, stdio: "inherit" });

  // husky init creates .husky/ and adds prepare script
  const runCmd: Record<PackageManager, string> = {
    bun: "bunx husky init",
    npm: "npx husky init",
    yarn: "npx husky init",
    pnpm: "pnpm exec husky init",
  };

  exec(runCmd[pm]);

  // commit-msg hook
  const commitMsgHook = `npx --no -- commitlint --edit $1`;
  writeFileSync(join(cwd, ".husky", "commit-msg"), commitMsgHook + "\n");
  log("Created .husky/commit-msg");

  // pre-commit hook
  const preCommitHook = `npx lint-staged`;
  writeFileSync(join(cwd, ".husky", "pre-commit"), preCommitHook + "\n");
  log("Created .husky/pre-commit");
}

// ---------------------------------------------------------------------------
// generateConfigs
// ---------------------------------------------------------------------------

function generateConfigs(cwd: string): void {
  heading("Generating config files");

  // commitlint.config.js
  const commitlintPath = join(cwd, "commitlint.config.js");
  if (!existsSync(commitlintPath)) {
    writeFileSync(
      commitlintPath,
      `export default { extends: ["@commitlint/config-conventional"] };\n`,
    );
    log("Created commitlint.config.js");
  } else {
    log("commitlint.config.js already exists — skipped");
  }

  // lint-staged config in package.json
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (!pkg["lint-staged"]) {
      pkg["lint-staged"] = {
        "*": "echo 'lint-staged: configure your linters here'",
      };
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
      log("Added lint-staged placeholder to package.json");
    } else {
      log("lint-staged config already exists — skipped");
    }
  }
}

// ---------------------------------------------------------------------------
// detectCodingTool
// ---------------------------------------------------------------------------

function detectCodingTool(cwd: string): CodingTool {
  if (existsSync(join(cwd, ".claude"))) return "claude";
  if (existsSync(join(cwd, ".cursor"))) return "cursor";
  if (existsSync(join(cwd, ".github"))) return "copilot";
  if (existsSync(join(cwd, ".gemini"))) return "gemini";
  return "fallback";
}

// ---------------------------------------------------------------------------
// loadStepFiles
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx !== -1) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return { meta, body: match[2] };
}

function loadStepFiles(): StepFile[] {
  const stepsDir = join(packageRoot(), "assets", "steps");
  if (!existsSync(stepsDir)) {
    console.error(`Steps directory not found: ${stepsDir}`);
    process.exit(1);
  }

  const files = readdirSync(stepsDir).filter((f) => f.endsWith(".md")).sort();
  return files.map((f) => {
    const raw = readFileSync(join(stepsDir, f), "utf-8");
    const { meta, body } = parseFrontmatter(raw);
    return {
      name: meta["name"] || f.replace(/\.md$/, ""),
      description: meta["description"] || "",
      allowedTools: meta["allowed-tools"] || "",
      body: body.trim(),
      raw,
    };
  });
}

// ---------------------------------------------------------------------------
// deploySkills
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function deploySkills(cwd: string, tool: CodingTool, steps: StepFile[]): void {
  heading(`Deploying skills (${tool})`);

  for (const step of steps) {
    switch (tool) {
      case "claude": {
        const dir = join(cwd, ".claude", "skills", step.name);
        ensureDir(dir);
        writeFileSync(join(dir, "SKILL.md"), step.raw);
        log(`.claude/skills/${step.name}/SKILL.md`);
        break;
      }
      case "cursor": {
        const dir = join(cwd, ".cursor", "rules");
        ensureDir(dir);
        // Convert to Cursor .mdc frontmatter format
        const mdcContent = [
          "---",
          `description: ${step.description}`,
          `globs: `,
          `alwaysApply: false`,
          "---",
          "",
          step.body,
        ].join("\n");
        writeFileSync(join(dir, `${step.name}.mdc`), mdcContent + "\n");
        log(`.cursor/rules/${step.name}.mdc`);
        break;
      }
      case "copilot": {
        const dir = join(cwd, ".github", "instructions");
        ensureDir(dir);
        writeFileSync(join(dir, `${step.name}.instructions.md`), step.body + "\n");
        log(`.github/instructions/${step.name}.instructions.md`);
        break;
      }
      case "gemini": {
        const dir = join(cwd, ".gemini", "rules");
        ensureDir(dir);
        writeFileSync(join(dir, `${step.name}.md`), step.body + "\n");
        log(`.gemini/rules/${step.name}.md`);
        break;
      }
      case "fallback": {
        // Will be handled in deployInstructionFile
        log("Skills will be embedded in AGENTS.md");
        return; // no per-file deploy
      }
    }
  }
}

// ---------------------------------------------------------------------------
// deployInstructionFile
// ---------------------------------------------------------------------------

const WORKFLOW_SECTION = `## Workflow

Orient → Dialogue → Test ⇄ Implement`;

function deployInstructionFile(cwd: string, tool: CodingTool, steps: StepFile[]): void {
  heading("Updating instruction file");

  const agentsPath = join(cwd, "AGENTS.md");
  let content = existsSync(agentsPath) ? readFileSync(agentsPath, "utf-8") : "";

  // Add workflow section if not present
  if (!content.includes("Orient → Dialogue → Test ⇄ Implement")) {
    content = content.trimEnd() + "\n\n" + WORKFLOW_SECTION + "\n";
    log("Added Workflow section to AGENTS.md");
  } else {
    log("Workflow section already present — skipped");
  }

  // For fallback tool, embed step bodies as sections
  if (tool === "fallback") {
    for (const step of steps) {
      const sectionHeader = `### ${step.name}`;
      if (!content.includes(sectionHeader)) {
        content += "\n" + sectionHeader + "\n\n" + step.body + "\n";
        log(`Embedded ${step.name} section in AGENTS.md`);
      }
    }
  }

  writeFileSync(agentsPath, content);
}

// ---------------------------------------------------------------------------
// printSummary
// ---------------------------------------------------------------------------

function printSummary(pm: PackageManager, tool: CodingTool, steps: StepFile[]): void {
  console.log("\n────────────────────────────────────────");
  console.log("  ✓ @zipbul/blazewrit initialized");
  console.log("────────────────────────────────────────");
  console.log(`  Package manager : ${pm}`);
  console.log(`  Coding tool     : ${tool}`);
  console.log(`  Skills deployed : ${steps.map((s) => s.name).join(", ")}`);
  console.log(`  Dev deps        : ${DEV_DEPS.join(", ")}`);
  console.log("");
  console.log("  Next step:");
  console.log("  Ask your AI agent to read prompts/blazewrit.md");
  console.log("  and customize the workflow for this project.");
  console.log("────────────────────────────────────────\n");
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

function init(cwd: string): void {
  console.log("\n@zipbul/blazewrit init\n");

  const pm = detectPackageManager(cwd);
  log(`Detected package manager: ${pm}`);

  installDevDeps(cwd, pm);
  setupHusky(cwd, pm);
  generateConfigs(cwd);

  const tool = detectCodingTool(cwd);
  log(`Detected coding tool: ${tool}`);

  const steps = loadStepFiles();
  log(`Loaded ${steps.length} step files`);

  deploySkills(cwd, tool, steps);
  deployInstructionFile(cwd, tool, steps);
  printSummary(pm, tool, steps);
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0];

if (command === "init") {
  const cwd = resolve(args[1] || process.cwd());
  init(cwd);
} else {
  console.log("Usage: blazewrit init [directory]");
  process.exit(1);
}
