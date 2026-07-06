import type { FlowType } from '@bw/dto';

/** Classifies a raw intent into a flow type (which workflow to run). */
export interface FlowClassifier {
  classify(text: string): FlowType;
}

/**
 * TEMPORARY keyword flow classifier — the project-side fallback that maps an inbound request to a
 * workflow type. Distinct from the central TriageAgent (which structures intent against DB state);
 * this only picks a flow. Defaults to feature. (Only feature currently has a workflow definition.)
 */
export class StubFlowClassifier implements FlowClassifier {
  classify(text: string): FlowType {
    const t = text.toLowerCase();
    if (/\bbug\b|\bfix\b|버그|고쳐|오류/.test(t)) return 'bugfix';
    if (/refactor|리팩터|정리/.test(t)) return 'refactor';
    if (/migrat|마이그|업그레이드/.test(t)) return 'migration';
    return 'feature';
  }
}
