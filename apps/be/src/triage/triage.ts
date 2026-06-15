import type { FlowType } from '@bw/dto';

/** Classifies a raw intent into a flow type (which workflow to run). */
export interface Triage {
  classify(text: string): FlowType;
}

/**
 * TEMPORARY keyword triage — replaced by an LLM classifier. Maps obvious intents,
 * defaults to feature. (Only feature currently has a workflow definition.)
 */
export class StubTriage implements Triage {
  classify(text: string): FlowType {
    const t = text.toLowerCase();
    if (/\bbug\b|\bfix\b|버그|고쳐|오류/.test(t)) return 'bugfix';
    if (/refactor|리팩터|정리/.test(t)) return 'refactor';
    if (/migrat|마이그|업그레이드/.test(t)) return 'migration';
    return 'feature';
  }
}
