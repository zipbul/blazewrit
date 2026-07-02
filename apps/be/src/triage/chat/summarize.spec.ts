import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { ensureSchema } from '../../infra/schema';
import { recordTurn } from './turns';
import { maybeSummarize, latestSummary, SUMMARIZE_THRESHOLD, SUMMARIZE_CHUNK } from './summarize';

/**
 * Step-8 contract (TDD): when a scope's un-summarized turns exceed the threshold, compress the
 * oldest CHUNK into one role='summary' row (payload.upTo = last covered seq). The window
 * assembler injects the latest summary above the recent window, closing the turns-13..N gap.
 */
const sql = new SQL(process.env.BW_PG_URL ?? 'postgres://postgres:blazewrit@localhost:3446/blazewrit');
const MARK = `sum-${Date.now()}`;
const SCOPE = 'central'; // summarization v1 targets the central scope

const fakeSummarizer = async (turns: Array<{ role: string; text: string }>) =>
  `요약: ${turns.length}턴 (${turns[0]!.text} ~ ${turns.at(-1)!.text})`;

async function seed(n: number): Promise<number[]> {
  const seqs: number[] = [];
  for (let i = 1; i <= n; i++) {
    const r = await recordTurn(sql, { scope: SCOPE, role: i % 2 ? 'user' : 'agent', text: `${MARK} t${i}` });
    seqs.push(r.seq);
  }
  return seqs;
}

beforeAll(async () => {
  await ensureSchema(sql);
  await sql`delete from chat_messages where scope = ${SCOPE} and (text like ${MARK + '%'} or text like '요약:%' )`;
});

afterAll(async () => {
  await sql`delete from chat_messages where text like ${MARK + '%'} or (scope = ${SCOPE} and role = 'summary' and text like '요약:%')`;
  await sql.end();
});

describe('maybeSummarize', () => {
  it('does nothing below the threshold', async () => {
    await seed(5);
    const made = await maybeSummarize(sql, SCOPE, fakeSummarizer);
    expect(made).toBe(false);
    expect(await latestSummary(sql, SCOPE)).toBeNull();
  });

  it('past the threshold: compresses the oldest CHUNK into one summary row with payload.upTo', async () => {
    const seqs = await seed(SUMMARIZE_THRESHOLD); // now well past threshold (5 + 60)
    const made = await maybeSummarize(sql, SCOPE, fakeSummarizer);
    expect(made).toBe(true);

    const s = await latestSummary(sql, SCOPE);
    expect(s).not.toBeNull();
    expect(s!.text).toContain('요약:');
    expect(s!.text).toContain(`${SUMMARIZE_CHUNK}턴`);
    // covers exactly the oldest CHUNK of un-summarized turns
    expect(s!.upTo).toBeGreaterThan(0);
    expect(s!.upTo).toBeLessThan(seqs.at(-1)!);
  });

  it('is idempotent right after summarizing (remaining turns under threshold again)', async () => {
    const made = await maybeSummarize(sql, SCOPE, fakeSummarizer);
    expect(made).toBe(false);
  });

  it('a second pass only summarizes turns AFTER the previous upTo', async () => {
    const before = (await latestSummary(sql, SCOPE))!;
    await seed(SUMMARIZE_THRESHOLD); // push past threshold again
    const made = await maybeSummarize(sql, SCOPE, fakeSummarizer);
    expect(made).toBe(true);
    const after = (await latestSummary(sql, SCOPE))!;
    expect(after.upTo).toBeGreaterThan(before.upTo);
  });
});
