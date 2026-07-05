import { describe, expect, it } from 'bun:test';
import { FLOW_TYPES, type FlowType } from '@bw/dto';
import { buildWorkflow } from './build-workflow';
import { WORKFLOWS } from './workflows';

/**
 * Regression lock: buildWorkflow must reproduce EVERY current hard-coded flow exactly when fed
 * that flow's own step names. This proves the agent-assembly path is not a behavior regression —
 * the 7 legacy flows remain its default outputs.
 */
describe('buildWorkflow reproduces the legacy WORKFLOWS table', () => {
  for (const flowType of FLOW_TYPES as readonly FlowType[]) {
    it(`${flowType} — same steps + same gates as the hard-coded table`, () => {
      const legacy = WORKFLOWS[flowType];
      const picks = legacy.steps.map((s) => s.name);
      const built = buildWorkflow(flowType, picks);
      expect(built.steps).toEqual(legacy.steps);
    });
  }
});
