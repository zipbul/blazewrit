---
name: test
description: Design and write tests before implementation. Use when tests need creation, strategy decision, or acceptance criteria verification.
allowed-tools: Read, Glob, Grep, Write, Edit, Bash
---

# Test

Business logic, branching, money/auth/permissions → TDD (RED → GREEN → REFACTOR).
Established patterns, integration → tests after.
Pure config or static content → no unit tests.

Confirm tests catch failures: TDD — write test, confirm RED, implement, confirm GREEN. Tests-after — confirm GREEN, break code, confirm RED, restore.

Mock only slow, non-deterministic, or external boundaries. If you need to mock internal logic, the code needs restructuring.

When a test fails: test asserts implementation detail + impl follows standards → fix test. Test asserts behavior + wrong result → fix implementation.
