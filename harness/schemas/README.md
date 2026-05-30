# harness/schemas — structured_output JSON Schemas (DESIGN artifacts)

> **Status: DESIGN, not implemented.** The harness runtime does not exist yet. These
> schemas are the §16 enforcement-layer design for the 10 step AI-harness steps. They are
> written to be enforced at **token generation** (grammar-constrained generation) once the
> harness is built on the Claude Agent SDK `structured_output` (DECISIONS §6, §16).

## What is here

| File | Role |
|---|---|
| `_defs.schema.json` | **Shared `$defs` — the single source of reusable primitives.** The 10 per-step schemas `$ref` these so no step re-invents `CountClaim`, the degrade union, provenance, etc. (avoids the M4 single-source drift the R-rule cleanup warned about). |
| `<step>.schema.json` | one per step (all 10 present): triage / ground / investigate / decide / spec / test / implement / report / verify / reflect. Each `$ref`s `_defs.schema.json`. |

Per-step schemas reference shared primitives like:

```json
{ "$ref": "./_defs.schema.json#/$defs/CountClaim" }
```

## The 4 mechanisms (and what each schema does / does NOT do)

The R-rule cleanup (`HARNESS_FLOW_REVIEW.md`) collapsed 36 prose rules onto 4 enforcement
mechanisms + an irreducible floor. These schemas are **M1 only**. They name their M2/M3
siblings but do not (and cannot) implement them.

- **M1 — grammar (THIS layer = SHAPE).** The JSON Schema is compiled to a grammar; the model
  *cannot emit* a wrong shape, a bad enum, or a missing required field. This closes the SHAPE
  half of format-drift and field-existence gaps. Examples here: `CountClaim` makes a bare
  integer for a measured count **unrepresentable** (R23); `Omitted` makes `null` / a sentinel
  / a `"# OMITTED"` placeholder string **unrepresentable** (R22); discriminated `oneOf`s force
  exactly one branch.

- **M2 — deterministic code validator (TRUTH, NOT in the schema).** Grammar enforces shape;
  it **cannot** enforce truth or cross-field/cross-run consistency. Each truth-bearing `$def`
  carries an `x-validator-contract` annotation naming the sibling code check the orchestrator
  must run — e.g. re-parse `source.raw_stdout` and re-derive `CountClaim.value`; re-execute a
  `VerifyProbe`; re-hash every `Sha256`; assert every `SourceManifest` cited line exists;
  `pid(run1) != pid(run2)` for `ExecMeta`; `declared_next_step == expected_next_step` (R16);
  same-file tasks ⇒ `parallel_marker=false` (R19/R33). `x-validator-contract` is a custom
  **annotation** (spec-compliant validators ignore unknown `x-*` keywords) — it documents the
  M2 contract, it does **not** pretend grammar enforces truth.

- **M3 — degrade as a schema BRANCH (in the schema, via discriminated union).** Tool absence /
  failure / timeout is a first-class branch, not a hole. `DegradableMeasurement` is the reusable
  `oneOf(Measured | Omitted)` discriminated on `status`. Any field backed by a tool that can be
  absent (Ground volatile typecheck/test/lint, perf_baseline, MCP/ED graph, observability,
  pyreez) uses it. Each step **specializes the `Measured.value`** sub-schema; the `Omitted`
  branch stays shared. This is M3 done *in M1* — the grammar forces one complete branch.

- **M4 — single source.** `_defs.schema.json` *is* the M4 application for primitives: one
  canonical `CountClaim`, one `RowRef`, one `StepName`, etc., so the 10 step schemas cannot
  drift. (Flow-definition M4 — the single machine source for flow chains — is a separate
  artifact, not these schemas.)

- **Irreducible floor (closed by nothing).** `UnverifiedFlag` (KEEP polarity — *designed to
  persist*; Verify is the single gate; **no** "no unverified remain" forbid exists) and
  `CrossVerifyFlag` (R5 high-stakes trigger) live here. Self-asserted truth (an honest-looking
  `unverified:false` on a hallucination; a `value` fitted to a forged `raw_stdout`) and
  semantic boundary-prose are **mitigated** by cross-verification + replay, **not eliminated**.

## §5 storage law — `based_on` / `*_ref` are Postgres row refs, not files

Step outputs persist to **Postgres** `step_runs` jsonb (DECISIONS §5). Therefore every
cross-step reference — `based_on`, `ground_ref`, `investigate_ref`, `input_refs`,
`unknown_ref`, every `*_ref` — is a **`RowRef`** (a Postgres row id), **never a file path**.
Legacy prose paths like `.blazewrit/grounds/**` or `flow-history/<id>.json` are PRE-§5 and are
translated to row refs here.

**The one file-path exception** in the entire harness: Reflect **Tier 2**
`.claude/rules/<topic>.md` (`RulesFilePath`) — a real file because Claude Code reads it as
context input. Reflect **Tier 1** raw output → Postgres (a `RowRef`), not a flow-history file.

## Validation

All 11 files compile clean under a strict draft 2020-12 validator. Mechanically verified
(parent session, `jsonschema` Draft202012):

- **11/11** valid Draft 2020-12; **0** broken `$ref` (every same-doc + cross-file ref resolves).
- **0** M4 primitive drift (no step re-invents a shared `$def`); **0** §5 violations (no `*_ref`
  is a file path).
- **Satisfiability** (the grammar can actually produce valid output): a valid instance was
  generated for every step schema and **every discriminated-union branch** — incl. all 6
  `report_type` branches, both Verify `flow_kind` variants, all 4 Triage output types.

A 22-agent design+adversarial pass (6 schemas faithful, 4 mostly) surfaced **3 real grammar
bugs** — all fixed and re-verified:

1. `implement.based_on` used `oneOf` for "min-1 of (Spec|Decide)" → a Decide-then-Spec chain
   carrying **both** refs was ungeneratable. Fixed: `oneOf → anyOf`.
2. `report` top-level `additionalProperties:false` made the `spike` / `plan_standalone` /
   `compound` branches **unsatisfiable** (branch-local props rejected by the top object). Fixed:
   `additionalProperties:false → unevaluatedProperties:false` (the pattern triage already used).
3. `verify.internal_passes` `if/then` only *added* a required Pass-1 variant, never *forbade*
   the other → a `non_code` verify could carry both `pass1_mechanical` and `pass1_completeness`.
   Fixed: each `flow_kind` branch now forbids the wrong variant (`property: false`).

Also: `investigate.CompatibilityIssue.source_tool` promoted to `required` (the claimed R26
provenance floor is now grammar-enforced, not just declared); `ground` gained `source_manifest`
(R36 realized in the canonical citation step).

Benign notes: `format: date-time` is an annotation (enforced only with a formats plugin), and
`x-*` keywords are spec-allowed custom annotations ignored by validators — both intentional.

**Honest residual:** these are **M1 only**. The `x-validator-contract` (M2) checks are *design
annotations* — the deterministic validator code does not exist yet (the harness is unimplemented).
These schemas are the design artifact, not a running enforcement layer.
