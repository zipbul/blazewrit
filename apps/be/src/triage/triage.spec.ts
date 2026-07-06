import { test, expect } from 'bun:test';
import { StubFlowClassifier } from './triage';

const triage = new StubFlowClassifier();

test('classifies a fix request as bugfix', () => {
  expect(triage.classify('이 버그 고쳐줘')).toBe('bugfix');
});

test('classifies a refactor request as refactor', () => {
  expect(triage.classify('이 코드 리팩터해줘')).toBe('refactor');
});

test('classifies a migration request as migration', () => {
  expect(triage.classify('React 18로 마이그레이션해줘')).toBe('migration');
});

test('defaults to feature for a build request', () => {
  expect(triage.classify('로그인 기능 추가해줘')).toBe('feature');
});
