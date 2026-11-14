import assert from 'node:assert/strict';
import test from 'node:test';
import { renderShellPage } from '../electron/shell-page.js';

const page = renderShellPage('offline', 'Prismata');

function assertPageMatches(pattern: RegExp, description: string): void {
  assert.ok(pattern.test(page), `shell page should include ${description}`);
}

test('TODOs is the first tab and Tip History is a separate, accessible second tab and list', () => {
  const todoTab = page.indexOf('id="todo-tab"');
  const historyTab = page.indexOf('id="tip-history-tab"');
  const todoPanel = page.indexOf('id="todo-panel"');
  const historyPanel = page.indexOf('id="tip-history-panel"');
  const todoList = page.indexOf('id="todo-list"');
  const historyList = page.indexOf('id="tip-history-list"');

  assert.ok(todoTab >= 0 && historyTab > todoTab, 'TODOs tab is rendered before the Tip History tab');
  assert.ok(todoPanel >= 0 && historyPanel > todoPanel, 'the TODO panel precedes a distinct Tip History panel');
  assert.ok(todoList >= 0 && historyList > todoList, 'history uses its own list instead of mixing with TODO rows');
  assertPageMatches(/role="tablist"/, 'an accessible tab list');
  assertPageMatches(/id="todo-tab"[^>]*role="tab"[^>]*aria-selected="true"[^>]*aria-controls="todo-panel"/,
    'TODOs initially selected and controlling its panel');
  assertPageMatches(/id="tip-history-tab"[^>]*role="tab"[^>]*aria-selected="false"[^>]*aria-controls="tip-history-panel"/,
    'Tip History as the separate initially unselected second tab');
  assertPageMatches(/<p class="eyebrow">Tip History<\/p>/,
    'Tip History as the archive eyebrow');
  assertPageMatches(/<nav id="tip-history-pagination"[^>]*aria-label="Tip History pages"[^>]*hidden>/,
    'an accessible pagination control that is hidden when not needed');
  assertPageMatches(/id="tip-history-previous"[^>]*>Previous<\/button>[\s\S]*?id="tip-history-next"[^>]*>Next<\/button>/,
    'previous and next page controls');
  assert.doesNotMatch(page, /<h2\b[^>]*id="tip-history-heading"/, 'no duplicate Tip History heading');
  assert.doesNotMatch(page, /Real tips received while Prismata is connected/, 'no explanatory tip-history paragraph');
  assert.doesNotMatch(page, /id="tip-history-status"/, 'no separate tip-history status container');
  assertPageMatches(/tip-history-tab[\s\S]*?(?:onclick|addEventListener)[\s\S]*?tip-history-panel/,
    'a handler that switches to the history panel');
  assert.doesNotMatch(page, /\.activity-tabs\s*\{[^}]*border-bottom/i, 'activity tabs without a bottom border');
});

test('tip history loads and updates independently, showing each title before expandable safe details', () => {
  assertPageMatches(/prismataDesktop\.tipHistory/, 'a dedicated history preload API');
  assertPageMatches(/tipHistory\.list\s*\(\)/, 'a persisted history load on page startup');
  assertPageMatches(/tipHistory\.onListChanged\s*\(/, 'a live history subscription');
  assertPageMatches(/pagehide[\s\S]{0,180}unsubscribeTipHistory\s*\(/,
    'page-hide cleanup for the history subscription');
  assertPageMatches(/createElement\(['"]details['"]\)/, 'native expandable details disclosures');
  assertPageMatches(/createElement\(['"]summary['"]\)/, 'a visible collapsed title summary');
  assertPageMatches(/title\.textContent\s*=\s*tip\.title[\s\S]*?summary\.append\(title\)/,
    'the entry title stays on the left in the visible collapsed summary');
  assertPageMatches(/function formatTipHistoryDateTime\(value\)[\s\S]*?date\.getHours\(\)[\s\S]*?date\.getMinutes\(\)[\s\S]*?date\.getSeconds\(\)/,
    'timestamps formatted in the desktop local timezone with seconds');
  assertPageMatches(/const tipHistoryPageSize\s*=\s*15/,
    'pages limited to 15 history records');
  assertPageMatches(/snapshot\.slice\(\(tipHistoryCurrentPage\s*-\s*1\)\s*\*\s*tipHistoryPageSize,\s*tipHistoryCurrentPage\s*\*\s*tipHistoryPageSize\)/,
    'only the current page of records rendered');
  assertPageMatches(/tip-history-previous'\)\.onclick[\s\S]*?tipHistoryCurrentPage\s*-=?\s*1[\s\S]*?renderTipHistory\(tipHistoryCurrentSnapshot\)/,
    'previous control changes the visible page');
  assertPageMatches(/tip-history-next'\)\.onclick[\s\S]*?tipHistoryCurrentPage\s*\+=\s*1[\s\S]*?renderTipHistory\(tipHistoryCurrentSnapshot\)/,
    'next control changes the visible page');
  assertPageMatches(/date\.className\s*=\s*'tip-history-date'[\s\S]*?date\.textContent\s*=\s*dateTime[\s\S]*?summary\.append\(date\)/,
    'the formatted date and time stay on the right side of the dropdown summary when expanded');
  assertPageMatches(/\.tip-history-date\s*\{[^}]*float:\s*right[^}]*color:\s*#[0-9a-f]{6}/i,
    'the right-aligned timestamp uses darker text');
  assert.doesNotMatch(page, /occurred\.textContent\s*=\s*'Received: '/,
    'the timestamp is not repeated lower in the expanded details');
  for (const field of ['viewer', 'amount', 'occurredAt']) {
    assertPageMatches(new RegExp(`tip\\.${field}`), `expanded details for ${field}`);
  }
});
