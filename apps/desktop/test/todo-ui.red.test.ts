import assert from 'node:assert/strict';
import test from 'node:test';
import { renderShellPage } from '../electron/shell-page.js';

const page = renderShellPage('offline', 'Prismata');

function assertPageMatches(pattern: RegExp, description = pattern.toString()): void {
  assert.ok(pattern.test(page), `shell page should include ${description}`);
}

test('TODO section has an accessible label, live list region, and empty state without redundant panel copy', () => {
  assertPageMatches(/<section\b[^>]*aria-label="Task list"/, 'an accessible label for the TODO list');
  assert.doesNotMatch(page, /<p class="eyebrow">Stream activity<\/p>|<h2 id="activity-heading">Stream activity<\/h2>/,
    'the Stream activity heading is omitted from the panel contents');
  assert.doesNotMatch(page, /id="todo-heading"|Add and track tasks locally|id="joystick-viewer-count"|>0 viewers</,
    'the list omits its redundant heading, description, and viewer count');
  assertPageMatches(/id="todo-tab"[^>]*>TODOs<\/button>/, 'the TODO tab retains its navigation label');
  assertPageMatches(/<(?:div|ul|ol)\b(?=[^>]*\bid="todo-list")(?=[^>]*\brole="list")(?=[^>]*\baria-live="polite")[^>]*>/, 'an accessible live list region');
  assertPageMatches(/No TODOs yet|No tasks yet/i, 'an empty-list message');
});

test('manual TODO form requires only the item name and wires the add action', () => {
  const itemName = page.match(/<(?:input|textarea)\b(?=[^>]*\bid="todo-item-name")[^>]*>/)?.[0];
  const viewer = page.match(/<(?:input|textarea)\b(?=[^>]*\bid="todo-viewer")[^>]*>/)?.[0];
  const note = page.match(/<(?:input|textarea)\b(?=[^>]*\bid="todo-note")[^>]*>/)?.[0];

  assertPageMatches(/<label\b[^>]*for="todo-item-name"[^>]*>Item name<\/label>/i, 'a label for the required item name');
  assert.ok(itemName, 'the item name field is present');
  assert.match(itemName!, /\brequired\b/);
  assert.ok(viewer, 'the optional viewer field is present');
  assert.ok(note, 'the optional note field is present');
  assert.doesNotMatch(viewer!, /\brequired\b/);
  assert.doesNotMatch(note!, /\brequired\b/);
  assertPageMatches(/id="todo-add"[^>]*>Save TODO<\/button>/i, 'a Save TODO action for new and edited rows');
  assertPageMatches(/todos\.add\s*\(/, 'the typed manual-add call');
  assertPageMatches(/\$\(['"]todo-add['"]\)\.onclick\s*=\s*addTodo/, 'the add action handler');
});

test('TODO UI loads persisted rows, subscribes to live snapshots, and unsubscribes on page hide', () => {
  assertPageMatches(/todos\.list\s*\(\)/, 'a persisted-list load through the TODO API');
  assertPageMatches(/todos\.onListChanged\s*\(/, 'a live-list subscription');
  assertPageMatches(/addEventListener\s*\(\s*['"]pagehide['"]/, 'page-hide cleanup for the live-list subscription');
  assertPageMatches(/unsubscribe\w*\s*\(\)/, 'an unsubscribe call');
  assertPageMatches(/Loading TODOs|Loading tasks/i, 'a visible loading state');
  assert.doesNotMatch(page, /TODOs loaded\./, 'successful loading does not show a completion message');
});

test('TODO completion calls the typed API and presents completed rows as muted with an undo action', () => {
  assertPageMatches(/todos\.complete\s*\(/, 'the typed completion call');
  assertPageMatches(/todo\.completedAt/, 'completed-state handling');
  assertPageMatches(/todo-completed|completed[^\n]{0,160}muted|muted[^\n]{0,160}completed/i, 'muted styling for completed rows');
  assertPageMatches(/todos\.undoComplete\s*\(/, 'the typed undo-completion call');
  assertPageMatches(/todos\.remove\s*\(/, 'the typed countdown removal call');
  assertPageMatches(/button\.textContent = completed \? '↶' : '✓'/, 'an undo icon replacing the checkmark after completion');
  assertPageMatches(/button\.onclick = \(\) => completed \? undoCompleteTodo\(todo\) : completeTodo\(todo\)/, 'an undo action on completed rows');
});

test('edited TODOs cannot be completed and stale edit forms clear on completion or removal', () => {
  assertPageMatches(/button\.disabled = completed \? undoing \|\| removing : pending \|\| removing \|\| editing/, 'the completion action disabled while editing');
  assertPageMatches(/todo\.completedAt \|\| editingTodoId === todo\.id \|\| completingTodoIds\.has\(todo\.id\)/, 'a guard against completing the edited TODO');
  assertPageMatches(/if \(!editedTodo \|\| editedTodo\.completedAt\) \{ editingTodoId = undefined; \$\('todo-form'\)\.reset\(\);/, 'clearing the edit form if the TODO is completed or disappears');
});

test('the completion button reflects edit state immediately and returns to normal after save', () => {
  assertPageMatches(/function editTodo\(todo\) \{[\s\S]*?editingTodoId = todo\.id;[\s\S]*?renderTodos\(currentTodos\);[\s\S]*?\}/,
    'rerendering the row after entering edit mode');
  assertPageMatches(/editingTodoId = undefined; \$\('todo-form'\)\.reset\(\); \$\('todo-status'\)\.textContent = ''; if \(!todoPageHidden\) renderTodos\(currentTodos\)/,
    'rerendering rows after a successful save clears edit mode');
});

test('TODO details appear in a hover and keyboard-focus tooltip while Complete stays visible', () => {
  assertPageMatches(/const details = document\.createElement\(['"]div['"]\); details\.className = 'todo-details'; details\.tabIndex = 0/, 'a focusable TODO details trigger');
  assertPageMatches(/tooltip\.setAttribute\('role', 'tooltip'\); details\.setAttribute\('aria-describedby', tooltip\.id\)/, 'an accessible tooltip description');
  assertPageMatches(/\.todo-details:hover \.todo-tooltip, \.todo-details:focus \.todo-tooltip \{ display: block; \}/, 'tooltip display on hover or keyboard focus');
  assertPageMatches(/button\.onclick = \(\) => completed \? undoCompleteTodo\(todo\) : completeTodo\(todo\); actions\.append\(button\)/, 'a visible checkmark or undo action beside the TODO details');
});

test('TODO rows are bordered cards with a white checkmark completion action', () => {
  assertPageMatches(/\.todo-row \{[^}]*border: 1px solid #[\da-f]{6};[^}]*background: #[\da-f]{6};/i, 'a border and background for each TODO row');
  assertPageMatches(/\.todo-row \{[^}]*align-items: center;/, 'vertical centering for the row text and action');
  assertPageMatches(/button\.todo-complete-button \{[^}]*padding: 0; border: 0;[^}]*background: transparent;/, 'a frameless, unpadded checkmark button');
  assertPageMatches(/button\.todo-complete-button \{[^}]*color: #fff;/, 'a white checkmark');
  assertPageMatches(/button\.textContent = completed \? '↶' : '✓'/, 'a checkmark instead of Complete text before completion');
  assertPageMatches(/button\.onclick = \(\) => completed \? undoCompleteTodo\(todo\) : completeTodo\(todo\)/, 'the completion and undo actions');
  assertPageMatches(/button\.setAttribute\('aria-label', actionLabel \+ todo\.itemName\)/, 'an accessible name for the checkmark');
});

test('completed TODOs show a live countdown to the left of the action buttons', () => {
  assertPageMatches(/todo\.completedAt\) \+ 30_000/, 'a 30-second expiry deadline based on completion time');
  assertPageMatches(/className = 'todo-expiry-timer';[^\n]*setAttribute\('role', 'timer'\)/, 'an accessible timer on completed rows');
  assertPageMatches(/timer\.textContent = seconds \+ 's'/, 'a seconds countdown');
  assertPageMatches(/row\.append\(details\); if \(expiryTimer\) row\.append\(expiryTimer\); row\.append\(actions\)/, 'the timer placed between row details and actions');
  assertPageMatches(/setInterval\(updateTodoExpiryTimers, 1000\)/, 'a once-per-second timer refresh');
  assertPageMatches(/clearInterval\(todoExpiryInterval\)/, 'timer cleanup when the page hides');
});

test('completed TODOs have an accessible trashcan removal action only during the countdown', () => {
  assertPageMatches(/if \(completed && expiryTimer && Number\(expiryTimer\.dataset\.deadline\) > Date\.now\(\)\)/, 'the removal action only while a completed item is counting down');
  assertPageMatches(/removeButton\.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18"/, 'a decorative trashcan icon');
  assertPageMatches(/removeButton\.setAttribute\('aria-label', 'Remove ' \+ todo\.itemName\)/, 'an accessible task-specific label');
  assertPageMatches(/removeButton\.disabled = removing \|\| editing/, 'the remove action disabled while this TODO is being edited');
  assertPageMatches(/if \(editingTodoId === todo\.id\) return;/, 'a guard against removing the actively edited TODO');
  assertPageMatches(/removeButton\.onclick = \(\) => removeTodo\(todo\)/, 'immediate removal without a confirmation prompt');
  assertPageMatches(/if \(!todo\.completedAt \|\| Date\.parse\(todo\.completedAt\) \+ 30_000 <= Date\.now\(\)/, 'preventing removal outside the countdown window');
  assertPageMatches(/await todos\.remove\(todo\.id\)/, 'the remove request');
  assertPageMatches(/button\.hidden = remainingMs <= 0/, 'hiding undo and remove once the countdown ends');
  assertPageMatches(/button\.todo-dismiss-button svg \{ width: 18px; height: 18px;/, 'a sized trashcan icon style');
});

test('manual TODOs have an accessible pencil editor that fills and saves the form details', () => {
  assertPageMatches(/todo\.source === 'Manual' && !completed/, 'edit controls only for open Manual TODOs');
  assertPageMatches(/const editPencilIcon = '<svg viewBox="0 0 24 24".*M16\.5 3\.5/, 'the shared SVG pencil icon');
  assertPageMatches(/edit: editPencilIcon/, 'the Reminders editor uses the shared SVG pencil icon');
  assertPageMatches(/editButton\.innerHTML = editPencilIcon/, 'the TODO editor uses the shared SVG pencil icon');
  assertPageMatches(/button\.todo-edit-button svg \{ width: 19px; height: 19px;/, 'the pencil icon sizing');
  assertPageMatches(/editButton\.setAttribute\('aria-label', 'Edit ' \+ todo\.itemName\)/, 'an accessible edit action');
  assertPageMatches(/\$\('todo-item-name'\)\.value = todo\.itemName/, 'the item name loaded into the form');
  assertPageMatches(/\$\('todo-viewer'\)\.value = todo\.viewer \|\| ''/, 'the viewer loaded into the form');
  assertPageMatches(/\$\('todo-note'\)\.value = todo\.note \|\| ''/, 'the note loaded into the form');
  assertPageMatches(/if \(editingTodoId\) await todos\.update\(editingTodoId, input\)/, 'saving edits through the typed update API');
  assertPageMatches(/id="todo-add"[^>]*>Save TODO<\/button>/, 'the form always uses Save TODO, including for new entries');
});

test('TODO values are rendered as text rather than interpolated as untrusted markup', () => {
  for (const field of ['itemName', 'viewer', 'note']) {
    assert.ok(
      new RegExp(`(?:text|escapeHtml)\\(\\w+\\.${field}\\)|textContent\\s*=\\s*[^;]*\\w+\\.${field}`).test(page),
      `${field} is escaped or assigned through textContent`,
    );
  }
  assertPageMatches(/function text\(value\)\s*\{\s*const node\s*=\s*document\.createElement\(['"]span['"]\);\s*node\.textContent\s*=\s*value;/,
    'the helper used to safely escape interpolated task text');
});

test('automatic TODO rows omit event time but display token amount metadata', () => {
  assert.doesNotMatch(page, /todo\.occurredAt|Event time/i, 'TODO rows do not display event time');
  assertPageMatches(/todo\.tokenAmount/, 'the persisted token amount');
  assertPageMatches(/Tokens?:/i, 'a visible token-amount label');
});

test('TODO form and list expose validation and errors without a redundant success container', () => {
  assertPageMatches(/id="todo-status"[^>]*(?:role="status"|aria-live="polite")/, 'an accessible status region');
  assertPageMatches(/#todo-status:empty \{ display: none; \}/, 'the empty status container is removed from the layout');
  assertPageMatches(/item name is required|enter an item name/i, 'visible required-name validation');
  assert.doesNotMatch(page, /TODO added\./, 'successful add does not show a redundant confirmation');
  assertPageMatches(/Unable to load TODOs|Could not load TODOs/i, 'a visible list-load error');
  assertPageMatches(/Unable to save TODO|Could not save TODO/i, 'a visible save error');
});
