import assert from 'node:assert/strict';
import test from 'node:test';
import { renderShellPage } from '../electron/shell-page.js';

function commandEditorPage() {
  return renderShellPage('offline', 'Prismata');
}

test('Add command creates an incomplete disabled entry and persists the updated command list', () => {
  const page = commandEditorPage();
  const contract = /id="slash-command-add"/.test(page)
    && /function addSlashCommand\(\)/.test(page)
    && /commands\.push\(\{\s*name:\s*'',\s*response:\s*'',\s*enabled:\s*false\s*\}\)/.test(page)
    && /\$\('slash-command-add'\)\.onclick\s*=\s*\(\)\s*=>\s*addSlashCommand\(\)/.test(page)
    && /saveSlashCommandSettings\(\)/.test(page)
    && /joystickChatAutomations\.updateSettings\(snapshot\)/.test(page);

  assert.ok(contract, 'Add command must append a disabled draft and save it through the settings-only automation API');
});

test('Command rows edit and persist the name and fixed response independently', () => {
  const page = commandEditorPage();
  const contract = /function renderSlashCommandList\(commands\)/.test(page)
    && /nameField\.value\s*=\s*command\.name/.test(page)
    && /responseField\.value\s*=\s*command\.response/.test(page)
    && /nameField\.onchange\s*=/.test(page)
    && /responseField\.onchange\s*=/.test(page)
    && /command\.name\s*=\s*nameField\.value/.test(page)
    && /command\.response\s*=\s*responseField\.value/.test(page)
    && /saveSlashCommandSettings\(\)/.test(page);

  assert.ok(contract, 'each configured command must allow editing and saving both name and fixed response');
});

test('Command enable and disable controls persist state and reject incomplete drafts', () => {
  const page = commandEditorPage();
  const contract = /function toggleSlashCommand\(command, toggle\)/.test(page)
    && /const enabled\s*=\s*!command\.enabled/.test(page)
    && /enabled\s*&&\s*\(!command\.name\.trim\(\)\s*\|\|\s*!command\.response\.trim\(\)\)/.test(page)
    && /command\.enabled\s*=\s*enabled/.test(page)
    && /setAttribute\('aria-checked',\s*String\(enabled\)\)/.test(page)
    && /toggle\.onclick\s*=\s*\(\)\s*=>\s*\{\s*void toggleSlashCommand\(command,\s*toggle\)/.test(page)
    && /saveSlashCommandSettings\(\)/.test(page);

  assert.ok(contract, 'the switch must persist both states and prevent enabling an incomplete command');
});

test('Delete command removes the selected entry and persists the remaining list', () => {
  const page = commandEditorPage();
  const contract = /function removeSlashCommand\(index\)/.test(page)
    && /commands\.splice\(index,\s*1\)/.test(page)
    && /removeButton\.onclick\s*=\s*\(\)\s*=>\s*removeSlashCommand\(index\)/.test(page)
    && /saveSlashCommandSettings\(\)/.test(page)
    && /joystickChatAutomations\.updateSettings\(snapshot\)/.test(page);

  assert.ok(contract, 'Delete must remove only the selected command and save the new settings');
});
