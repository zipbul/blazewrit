import { test, expect } from 'bun:test';
import { routeProject, deriveProjectName } from './router';

test('creates a new project named from the intent when none exist', () => {
  expect(routeProject('장바구니 기능 추가해줘', [])).toEqual({ kind: 'create', project: '장바구니' });
});

test('routes to an existing project mentioned in the intent', () => {
  expect(routeProject('장바구니 정렬 고쳐줘', ['demo', '장바구니'])).toEqual({ kind: 'existing', project: '장바구니' });
});

test('creates a new project when the intent matches no existing one', () => {
  expect(routeProject('결제 기능 추가', ['장바구니'])).toEqual({ kind: 'create', project: '결제' });
});

test('deriveProjectName strips a trailing Korean particle', () => {
  expect(deriveProjectName('결제를 빠르게 해줘')).toBe('결제');
});

test('deriveProjectName falls back to general for empty input', () => {
  expect(deriveProjectName('   ')).toBe('general');
});
