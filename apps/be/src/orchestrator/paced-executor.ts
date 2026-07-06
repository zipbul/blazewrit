import type { ProducerOutcome, ReviewOutcome, StepContext, StepExecutor } from './types';

/**
 * Auto-passing executor with a per-call delay that ALSO emits synthetic agent events,
 * so the metro animates AND the LIVE panel fills in real time without an LLM.
 * The real one is AgentStepExecutor.
 */
export class PacedStepExecutor implements StepExecutor {
  constructor(private readonly delayMs = 1200) {}

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async produce(ctx: StepContext): Promise<ProducerOutcome> {
    const half = this.delayMs / 3;
    ctx.emit?.({ type: 'thinking', payload: { text: `${ctx.step}: 작업 분석 중…` } });
    await this.wait(half);
    ctx.emit?.({ type: 'tool_use', payload: { name: 'Read', input: `${ctx.step} 관련 파일` } });
    await this.wait(half);
    ctx.emit?.({ type: 'tool_result', payload: { summary: `${ctx.step} 처리 완료` } });
    await this.wait(half);
    return { output: `${ctx.step} output` };
  }

  async review(ctx: StepContext): Promise<ReviewOutcome> {
    ctx.emit?.({ type: 'assistant', payload: { text: `${ctx.step} 검토 중…` } });
    await this.wait(this.delayMs);
    ctx.emit?.({ type: 'assistant', payload: { text: `${ctx.step} ✓ pass` } });
    return { verdict: 'pass' };
  }
}
