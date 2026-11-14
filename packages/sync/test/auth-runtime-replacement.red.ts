import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const authModulePath = new URL('../src/auth.ts', import.meta.url);
const authModuleSource = readFileSync(authModulePath, 'utf8');

test('shared auth module no longer imports Supabase directly', () => {
  assert.doesNotMatch(
    authModuleSource,
    /from '@supabase\/supabase-js';/,
    'packages/sync/src/auth.ts still imports @supabase/supabase-js, so shared auth still depends on Supabase types',
  );
});

test('shared auth module no longer exports legacy Supabase session surfaces', () => {
  assert.doesNotMatch(
    authModuleSource,
    /export function (bootstrapAnonymousSession|subscribeToAuthSession)\b/,
    'packages/sync/src/auth.ts still exports legacy Supabase-oriented auth bootstrap/subscription helpers',
  );
});
