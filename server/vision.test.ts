/** vision 端口单测：未配 key 时 createVision 必须返回恒定降级实现（永不联网）。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVision } from './vision.ts';

test('未配 key → createVision 返回恒定 null（降级，不联网）', async () => {
  const fn = createVision({ apiKey: '', baseUrl: 'http://127.0.0.1:1', model: 'none' });
  assert.equal(await fn(Buffer.from('not-a-png')), null);
});

test('未配 key 的实现对任意输入都 resolve null，不抛异常', async () => {
  const fn = createVision({ apiKey: '', baseUrl: 'x', model: 'm' });
  assert.equal(await fn(Buffer.alloc(0)), null);
});
