import { readFileSync } from 'node:fs';
import type { DesktopStatus } from '../src/desktop-lifecycle.js';

const joystickLogoDataUri = `data:image/svg+xml;base64,${readFileSync(new URL('./assets/joysticktv-logo-simple-dark.svg', import.meta.url)).toString('base64')}`;
const appVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] ?? character));
}

export function renderShellPage(status: string | DesktopStatus, title: string): string {
  const desktopStatus = typeof status === 'string' ? status : status.state;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'" />
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; background: #10131a; color: #f3f5f7; }
body { margin: 0; background: radial-gradient(circle at top right, #283650, #10131a 55%); } main { min-height: 100vh; box-sizing: border-box; padding: 32px 20px; }
.shell { width: min(900px, 100%); margin: auto; display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; } .shell > section:first-child { grid-column: 1 / -1; } section { padding: 24px; border: 1px solid #30394b; border-radius: 16px; background: #171b24; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
h1,h2 { margin: 0; } h1 { font-size: 1.6rem; } h2 { font-size: 1rem; color: #b9c5d8; } p { line-height: 1.5; } .eyebrow { margin: 0 0 8px; color: #91b9ff; font-size: .8rem; letter-spacing: .08em; text-transform: uppercase; }
.state { margin: 16px 0 4px; font-size: 1.15rem; font-weight: 650; } .muted { color: #aeb8c8; } .error { padding: 10px 12px; border-radius: 8px; color: #ffd9d9; background: #522b37; }
.error-toast { position: fixed; z-index: 2000; top: 16px; left: 50%; transform: translateX(-50%); display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; width: min(680px, calc(100vw - 32px)); max-height: 30vh; box-sizing: border-box; overflow-y: auto; padding: 12px 16px; border: 1px solid #a84c5b; border-radius: 10px; color: #ffd9d9; background: rgba(82, 43, 55, .98); box-shadow: 0 12px 32px rgba(0,0,0,.45); }
.error-toast-message { min-width: 0; flex: 1; overflow-wrap: anywhere; }
button.error-toast-dismiss { flex: 0 0 28px; width: 28px; min-width: 28px; height: 28px; min-height: 28px; margin: -6px -8px 0 0; padding: 0; border: 0; border-radius: 6px; color: inherit; background: transparent; box-shadow: none; font-size: 1.45rem; line-height: 1; }
button.error-toast-dismiss:hover { background: rgba(255,255,255,.12); }
.error-toast[hidden] { display: none; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; } button { min-height: 42px; padding: 9px 16px; border: 1px solid #6387c4; border-radius: 9px; color: #fff; background: #3265ad; font: inherit; cursor: pointer; } button.secondary { color: #dbe7ff; background: transparent; } button:disabled { cursor: wait; opacity: .55; } button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 3px solid #9fc2ff; outline-offset: 2px; }
 .lan { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; } code { color: #b9c5d8; overflow-wrap: anywhere; } .grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 14px 24px; margin: 20px 0; } .label { color: #aeb8c8; font-size: .8rem; display: block; margin-bottom: 4px; } .value { overflow-wrap: anywhere; }
  .empty-panel { min-height: clamp(120px, 20vh, 220px); padding: 0; }
  .reminder-row { align-items: center; }
  .reminder-main { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .reminder-main strong { color: #f3f5f7; }
  .reminder-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; }
  button.reminder-toggle { display: inline-flex; flex: 0 0 42px; align-items: center; justify-content: flex-start; width: 42px; min-width: 42px; height: 26px; min-height: 26px; padding: 2px; border: 1px solid #66738a; border-radius: 999px; background: #30394b; }
  button.reminder-toggle[aria-checked="true"] { justify-content: flex-end; border-color: #6387c4; background: #3265ad; }
  .reminder-toggle-thumb { width: 18px; height: 18px; border-radius: 50%; background: #fff; }
  button.reminder-icon-button { display: inline-flex; flex: 0 0 38px; align-items: center; justify-content: center; width: 38px; min-width: 38px; height: 38px; min-height: 38px; padding: 0; border-color: transparent; background: transparent; color: #dbe7ff; }
  button.reminder-icon-button:hover { background: rgba(159, 194, 255, .12); }
  button.reminder-icon-button svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  button.reminder-delete-button { color: #ff8a8a; }
  .whisper-rule input[type="checkbox"], #drop-in-chat-enabled { appearance: none; position: relative; display: inline-block; vertical-align: middle; width: 42px; min-width: 42px; height: 26px; box-sizing: border-box; margin: 0 8px 0 0; padding: 2px; border: 1px solid #66738a; border-radius: 999px; background: #30394b; cursor: pointer; transition: background 120ms ease, border-color 120ms ease; }
  .whisper-rule input[type="checkbox"]::before, #drop-in-chat-enabled::before { content: ""; display: block; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform 120ms ease; }
  .whisper-rule input[type="checkbox"]:checked, #drop-in-chat-enabled:checked { border-color: #6387c4; background: #3265ad; }
  .whisper-rule input[type="checkbox"]:checked::before, #drop-in-chat-enabled:checked::before { transform: translateX(16px); }
  .whisper-rule > label { align-self: start; }
  section[aria-label="Automations"] > .whisper-rule:first-of-type { border-top: 0; }
  .panel-bar { height: 60px; box-sizing: border-box; display: flex; justify-content: space-between; align-items: center; padding: 0 18px; border-radius: 15px 15px 0 0; background: #26344a; }
  .panel-viewers { display: inline-flex; align-items: center; gap: 8px; color: #e2eaf6; font-size: .95rem; font-variant-numeric: tabular-nums; }
  .panel-version { color: #aeb8c8; font-size: .75rem; }
 .panel-viewers svg { width: 20px; height: 20px; fill: currentColor; }
 .empty-panel-controls { display: flex; align-items: center; padding: 8px 18px; }
  .joystick-connect-button { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; width: 4.5rem; height: 4.5rem; min-height: 0; padding: .3rem; border: 1px solid rgba(148, 163, 184, .22); border-radius: 16px; background: #111827; color: inherit; }
 .joystick-connect-button.connected { background: #0c0c0c; }
  .joystick-logo { width: 2.9rem; height: 2.9rem; flex: 0 0 auto; object-fit: contain; filter: grayscale(1); transition: filter 120ms ease; }
  .joystick-connect-button.connected .joystick-logo { filter: grayscale(0); }
  .panel-live-indicator { color: #9299a7; font-size: .58rem; font-weight: 800; letter-spacing: .09em; line-height: 1; }
  .panel-live-indicator.live { color: #ff414e; }
 .chat-feed { height: 486px; box-sizing: border-box; overflow-y: auto; padding: 8px 10px; border: 1px solid #30394b; border-radius: 8px; background: #0b1018; }
  .chat-message { display: flex; align-items: center; gap: 8px; height: 18px; line-height: 18px; overflow: hidden; white-space: nowrap; font-size: .82rem; }
 .chat-message-author { flex: 0 0 auto; max-width: 10rem; overflow: hidden; color: #91b9ff; font-weight: 650; text-overflow: ellipsis; }
 .chat-message-text { min-width: 0; overflow: hidden; color: #e2eaf6; text-overflow: ellipsis; white-space: nowrap; }
  @media (min-width: 1200px) { .shell { width: min(1800px, 100%); grid-template-columns: 900px minmax(0, 900px); } }
  .direct-message-composer { display: flex; align-items: stretch; gap: 10px; }
  .direct-message-composer textarea { flex: 1 1 0; width: 0; min-width: 0; }
  .direct-message-composer button { flex: 0 0 auto; white-space: nowrap; }
  button.todo-dismiss-button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  button.todo-edit-button svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
 input, textarea { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #4a5972; border-radius: 8px; color: #eef4ff; background: #0f141e; font: .85rem ui-monospace, monospace; } input[type="checkbox"] { width: auto; margin-right: 8px; } .whisper-rule { display: grid; grid-template-columns: minmax(150px, .75fr) minmax(0, 2fr); gap: 10px 20px; align-items: center; padding: 14px 0; border-top: 1px solid #30394b; } .whisper-rule label { margin: 0; } .drop-in-message-row { display: flex; align-items: end; gap: 10px; margin: 8px 0; } .drop-in-message-field { flex: 1; min-width: 0; } .drop-in-message-row button { flex: 0 0 auto; } .device { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid #30394b; } .device:first-child { border-top: 0; } .todo-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 20px 0; } .todo-form .wide { grid-column: 1 / -1; } .todo-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 14px; border: 1px solid #30394b; border-radius: 10px; background: #10141e; } button.todo-complete-button { flex: 0 0 42px; width: 42px; min-width: 42px; height: 42px; min-height: 42px; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; display: inline-flex; align-items: center; justify-content: center; color: #fff; font-size: 1.35rem; line-height: 1; } button.todo-edit-button, button.todo-dismiss-button { flex: 0 0 42px; width: 42px; min-width: 42px; height: 42px; min-height: 42px; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; display: inline-flex; align-items: center; justify-content: center; color: #dbe7ff; font-size: 1.25rem; line-height: 1; } button.todo-dismiss-button { color: #ff8a8a; font-size: 1.1rem; } .todo-row-actions { display: flex; align-items: center; gap: 2px; } .tip-history-date { float: right; margin-left: 12px; color: #8b95a6; font-size: .85em; font-variant-numeric: tabular-nums; } .tip-history-pagination { display: flex; justify-content: center; align-items: center; gap: 12px; margin: 12px 0; } .tip-history-pagination[hidden] { display: none; } .todo-details { position: relative; flex: 1; min-width: 0; overflow-wrap: anywhere; outline: none; } .todo-details strong { cursor: help; font-weight: 650; } .todo-tooltip { display: none; position: absolute; z-index: 10; left: 0; bottom: calc(100% + 8px); width: max-content; max-width: min(28rem, calc(100vw - 64px)); padding: 10px 12px; border: 1px solid #4a5972; border-radius: 8px; background: #202838; box-shadow: 0 10px 30px rgba(0,0,0,.45); white-space: normal; overflow-wrap: anywhere; } .todo-details:hover .todo-tooltip, .todo-details:focus .todo-tooltip { display: block; } .todo-tooltip p { margin: 5px 0 0; } .todo-completed { opacity: .58; } .todo-expiry-timer { flex: 0 0 auto; min-width: 2.6rem; color: #b9c4d6; font-size: .78rem; font-variant-numeric: tabular-nums; text-align: center; } #todo-list:empty, #tip-history-list:empty, #todo-status:empty { display: none; } .activity-tabs { display: flex; gap: 10px; padding: 16px 0; } .activity-tabs [role="tab"][aria-selected="false"] { color: #dbe7ff; background: transparent; } .tip-history-row { padding: 12px 0; border-top: 1px solid #30394b; } .tip-history-row:first-child { border-top: 0; } .tip-history-row summary { cursor: pointer; font-weight: 650; overflow-wrap: anywhere; } .tip-history-row p { margin: 8px 0 0; } @media (max-width: 680px) { .grid, .whisper-rule, .todo-form { grid-template-columns: 1fr; } }
</style></head><body><div id="desktop-error" class="error-toast" role="alert" aria-live="assertive" hidden><span id="desktop-error-message" class="error-toast-message"></span><button id="desktop-error-dismiss" class="error-toast-dismiss" type="button" aria-label="Dismiss error" title="Dismiss">×</button></div><main><div class="shell">
  <section class="empty-panel" aria-label="Empty panel"><div class="panel-bar"><span class="panel-version">v${escapeHtml(appVersion)}</span><span class="panel-viewers" role="status" aria-label="Current viewer count" aria-live="polite"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c-5 0-9.3 3.1-11 7 1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-2.2a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z"></path></svg><span id="panel-viewer-count">0</span></span></div><div class="empty-panel-controls"><button id="joystick-connect" class="joystick-connect-button" type="button" aria-label="Connect to Joystick" aria-pressed="false"><img class="joystick-logo" src="${joystickLogoDataUri}" alt="" aria-hidden="true" /><span id="panel-live-indicator" class="panel-live-indicator" hidden>LIVE</span></button></div></section>
    <section aria-label="Direct message"><p class="eyebrow">Direct message</p><div id="joystick-chat-feed" class="chat-feed" role="log" aria-label="Recent stream chat messages" aria-live="polite" aria-relevant="additions text"><p class="muted">Waiting for public chat messages…</p></div><label class="label" for="direct-message-input">Message</label><div class="direct-message-composer"><textarea id="direct-message-input" maxlength="500" rows="3" autocomplete="off"></textarea><button id="direct-message-send" type="button">Send Message</button></div><p id="direct-message-status" class="muted" aria-live="polite"></p></section>
   <section aria-label="Stream activity"><div class="activity-tabs" role="tablist" aria-label="Stream activity"><button id="todo-tab" type="button" role="tab" aria-selected="true" aria-controls="todo-panel" tabindex="0">TODOs</button><button id="tip-history-tab" type="button" role="tab" aria-selected="false" aria-controls="tip-history-panel" tabindex="-1">Tip History</button></div><div id="todo-panel" role="tabpanel" aria-labelledby="todo-tab" tabindex="0"><section aria-label="Task list"><p class="eyebrow">Task list</p><form id="todo-form" class="todo-form" novalidate><div><label class="label" for="todo-item-name">Item name</label><input id="todo-item-name" name="itemName" type="text" maxlength="200" autocomplete="off" required /></div><div><label class="label" for="todo-viewer">Viewer (optional)</label><input id="todo-viewer" name="viewer" type="text" maxlength="100" autocomplete="off" /></div><div class="wide"><label class="label" for="todo-note">Note (optional)</label><textarea id="todo-note" name="note" rows="2" maxlength="2000"></textarea></div><div class="wide actions"><button id="todo-add" type="submit">Save TODO</button></div></form><p id="todo-status" class="muted" role="status" aria-live="polite">Loading TODOs…</p><div id="todo-list" role="list" aria-live="polite" aria-relevant="additions removals text"><p class="muted">Loading TODOs…</p></div></section></div><section id="tip-history-panel" role="tabpanel" aria-labelledby="tip-history-tab" tabindex="0" aria-label="Tip History" hidden><p class="eyebrow">Tip History</p><div id="tip-history-list" role="list" aria-live="polite" aria-relevant="additions removals text"><p class="muted">Loading Tip History…</p></div><nav id="tip-history-pagination" class="tip-history-pagination" aria-label="Tip History pages" hidden><button id="tip-history-previous" class="secondary" type="button">Previous</button><span id="tip-history-page" role="status" aria-live="polite"></span><button id="tip-history-next" class="secondary" type="button">Next</button></nav></section></section>
   <section aria-label="Automations"><p class="eyebrow">Automations</p><div class="whisper-rule"><label for="whisper-followed-enabled"><input id="whisper-followed-enabled" type="checkbox" role="switch" />New follower whisper</label><div><label class="label" for="whisper-followed-message">New follower message</label><textarea id="whisper-followed-message" rows="2" maxlength="500"></textarea></div></div><div class="whisper-rule"><label for="whisper-subscribed-enabled"><input id="whisper-subscribed-enabled" type="checkbox" role="switch" />New subscription / gift recipients whisper</label><div><label class="label" for="whisper-subscribed-message">New subscription message</label><textarea id="whisper-subscribed-message" rows="2" maxlength="500"></textarea></div></div><div class="whisper-rule"><label for="whisper-resubscribed-enabled"><input id="whisper-resubscribed-enabled" type="checkbox" role="switch" />Resubscription whisper</label><div><label class="label" for="whisper-resubscribed-message">Resubscription message</label><textarea id="whisper-resubscribed-message" rows="2" maxlength="500"></textarea></div></div><div class="whisper-rule"><label for="whisper-gift-sender-enabled"><input id="whisper-gift-sender-enabled" type="checkbox" role="switch" />Gift sender whisper</label><div><label class="label" for="whisper-gift-sender-message">Gift sender message</label><textarea id="whisper-gift-sender-message" rows="2" maxlength="500"></textarea></div></div><hr /><h3 id="drop-in-chat-heading" class="label">Drop-in public chat</h3><p class="muted">Send up to 10 messages in order when a viewer drops in. Requires chat:write and a live stream.</p><label for="drop-in-chat-enabled"><input id="drop-in-chat-enabled" type="checkbox" role="switch" />Drop-in chat messages</label><div id="drop-in-message-list" role="list" aria-label="Drop-in public chat messages"></div><div class="actions"><button id="drop-in-message-add" class="secondary" type="button">Add message</button></div><hr /><h3 class="label">Slash commands</h3><label class="label" for="slash-command-prefix">Global prefix</label><input id="slash-command-prefix" type="text" maxlength="1" value="!" /><div id="slash-command-list" role="list" aria-label="Slash commands"></div><div class="actions"><button id="slash-command-add" class="secondary" type="button">Add command</button></div><p id="slash-command-status" class="muted" role="status" aria-live="polite"></p></section>
   <section aria-label="Reminders"><p class="eyebrow">Reminders</p><div id="reminder-list" role="list" aria-live="polite"><p class="muted">No reminders yet.</p></div><div class="actions"><button id="reminder-add" type="button">Add reminder</button></div><div id="reminder-editor" hidden><hr /><h2 id="reminder-editor-heading">Reminder</h2><label class="label" for="reminder-task">What should Prismata send?</label><select id="reminder-task"><option value="custom-message">Send a custom message</option><option value="coin-flip">Flip a coin</option></select><div id="reminder-message-controls" hidden><p class="muted">Custom messages send in order, then rotate back to the beginning.</p><div id="reminder-message-list" role="list" aria-label="Reminder messages"></div><button id="reminder-message-add" class="secondary" type="button">Add message</button></div><label class="label" for="reminder-schedule">When should it send?</label><select id="reminder-schedule"><option value="interval">Every X minutes</option><option value="hourly" selected>Every hour</option><option value="daily">Every day at a selected local time</option></select><div id="reminder-interval-controls" hidden><label class="label" for="reminder-interval">Interval in minutes (1–59)</label><input id="reminder-interval" type="number" min="1" max="59" step="1" value="5" /><p class="muted">Send this reminder every X minutes, starting at local midnight.</p></div><label class="label" for="reminder-time" id="reminder-time-label">Local time</label><input id="reminder-time" type="time" value="09:00" /><p id="reminder-status" class="muted" aria-live="polite"></p><div class="actions"><button id="reminder-save" type="button">Save reminder</button><button id="reminder-cancel" class="secondary" type="button">Cancel</button></div></div></section>
  <section aria-labelledby="mobile-heading" hidden><div class="lan"><div><p class="eyebrow">Settings</p><h2 id="mobile-heading">Mobile access · LAN status</h2></div><code id="lan-status">${escapeHtml(desktopStatus)}</code></div><p id="lan-detail" class="muted">LAN access is disabled until you enable it.</p><p id="lan-warning" class="error" role="alert" hidden><strong>All-interface binding is enabled.</strong> This can expose Prismata to public or WAN networks. Use host firewall and network controls, and disable it when not needed.</p><div class="actions"><button id="lan-toggle" type="button">Enable LAN access</button><button id="advertising-retry" class="secondary" type="button" hidden>Retry advertising</button></div><label class="label" for="advertised-address">Advertise this interface/address</label><select id="advertised-address" disabled><option>Load eligible interfaces...</option></select><div class="grid" aria-label="LAN connection details"><div><span class="label">Bind host</span><code id="lan-host" class="value">Not available</code></div><div><span class="label">Advertised address</span><code id="advertised-host" class="value">Not available</code></div><div><span class="label">Endpoint</span><code id="endpoint" class="value">Not available</code></div><div><span class="label">Protocol</span><span id="protocol" class="value">HTTPS</span></div><div><span class="label">Discovery</span><span id="discovery" class="value">Stopped</span></div><div><span class="label">Fingerprint</span><code id="fingerprint" class="value">Not available</code></div></div></section>
 <section aria-labelledby="requests-heading" hidden><h2 id="requests-heading">Pending mobile connection requests</h2><p class="muted">Compare the confirmation code shown on the mobile device before explicitly approving access.</p><div id="requests" aria-live="polite"><p class="muted">No pending mobile requests.</p></div></section>
<section aria-labelledby="devices-heading" hidden><h2 id="devices-heading">Paired devices</h2><p id="devices-empty" class="muted">No mobile devices are paired.</p><div id="devices" aria-live="polite"></div></section>
</div></main><script>
(() => { const admin = window.prismataDesktop.admin; const auth = window.prismataDesktop.auth; const joystickWhispers = window.prismataDesktop.joystickWhispers; const $ = (id) => document.getElementById(id); const error = $('desktop-error'); const errorMessage = $('desktop-error-message'); let errorToastTimer; const editPencilIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"></path></svg>'; let currentStatus; let authErrorMessage;
const labels = {'signed-out':'Signed out','opening-browser':'Opening browser','waiting-for-callback':'Waiting for callback',authenticated:'Authenticated',failure:'Authentication failed',offline:'Offline'};
 function text(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }
 let messageVariableHelpId = 0;
 function appendMessageVariableDescriptions(target, variables) { const list = document.createElement('ul'); variables.forEach((variable) => { const item = document.createElement('li'); const token = document.createElement('code'); token.textContent = variable.token; item.append(token, document.createTextNode(' — ' + variable.description)); list.append(item); }); target.append(list); }
 function createMessageVariableInfo(context) {
   if (!document.head || typeof document.createTextNode !== 'function') return document.createElement('span');
   const variablesByContext = {
     whisper: [{ token: '{{sender}}', description: 'The event viewer username associated with this whisper.' }],
     'drop-in': [
       { token: '{{sender}}', description: 'The viewer display name or username for this Drop-in.' },
       { token: '{{number_of_viewers}}', description: 'The viewer count included in the Drop-in event.' },
       { token: '{{text}}', description: 'The text included with the Drop-in event.' },
       { token: '{{occurred_at}}', description: 'The timestamp for when the Drop-in event occurred.' },
     ],
      'slash-command': [
        { token: '{{sender}}', description: 'The command sender display name, falling back to their username.' },
      ],
   };
   const variables = variablesByContext[context] || [];
   if (!document.getElementById('message-variable-help-style')) {
     const style = document.createElement('style'); style.id = 'message-variable-help-style';
     style.textContent = '.message-field-heading{display:flex;align-items:center;gap:6px}.message-field-heading .label{margin-bottom:4px}.message-variable-help{position:relative;display:inline-flex;vertical-align:middle;margin-left:2px}.message-variable-help button.message-variable-info{display:inline-flex;align-items:center;justify-content:center;width:26px;min-width:26px;height:26px;min-height:26px;padding:0;border-radius:50%;color:#dbe7ff;background:#26344a}.message-variable-info svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8}.message-variable-tooltip{position:absolute;z-index:1001;left:0;bottom:calc(100% + 8px);width:min(320px,80vw);padding:10px 12px;border:1px solid #6387c4;border-radius:8px;background:#10141e;box-shadow:0 8px 24px rgba(0,0,0,.45);font-size:.8rem}.message-variable-tooltip ul,.message-variable-dialog-panel ul{margin:0;padding-left:20px}.message-variable-tooltip li,.message-variable-dialog-panel li{margin:4px 0}.message-variable-dialog{position:fixed;z-index:3000;inset:0;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.72)}.message-variable-dialog[hidden],.message-variable-tooltip[hidden]{display:none!important}.message-variable-dialog-panel{width:min(520px,100%);box-sizing:border-box;padding:22px;border:1px solid #6387c4;border-radius:12px;background:#171b24;box-shadow:0 20px 60px rgba(0,0,0,.55)}.message-variable-dialog-panel header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px}.message-variable-dialog-panel h2{color:#f3f5f7}';
     document.head.append(style);
   }
   const wrapper = document.createElement('span'); wrapper.className = 'message-variable-help';
   const button = document.createElement('button'); button.type = 'button'; button.className = 'message-variable-info'; button.setAttribute('aria-label', 'Show available message variables'); button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5M12 8h.01"></path></svg>';
   const helpTemplate = document.createElement('template'); helpTemplate.innerHTML = '<span class="message-variable-tooltip" role="tooltip" hidden></span><div class="message-variable-dialog" role="dialog" aria-modal="true" hidden></div>';
   const tooltip = helpTemplate.content.querySelector('[role="tooltip"]'); const dialog = helpTemplate.content.querySelector('[role="dialog"]');
   const helpId = 'message-variable-help-' + (++messageVariableHelpId); tooltip.id = helpId; button.setAttribute('aria-describedby', helpId);
   appendMessageVariableDescriptions(tooltip, variables);
   const panel = document.createElement('div'); panel.className = 'message-variable-dialog-panel';
   const header = document.createElement('header'); const heading = document.createElement('h2'); heading.id = helpId + '-heading'; heading.textContent = 'Available message variables';
   const close = document.createElement('button'); close.type = 'button'; close.className = 'secondary'; close.textContent = 'Close'; close.setAttribute('aria-label', 'Close message variable help');
   header.append(heading, close); panel.append(header); appendMessageVariableDescriptions(panel, variables); dialog.setAttribute('aria-labelledby', heading.id); dialog.append(panel);
   let infoHovered = false; let infoFocused = false;
   const updateTooltip = () => { tooltip.hidden = !(infoHovered || infoFocused); }; const closeDialog = () => { dialog.hidden = true; button.focus(); };
   button.addEventListener('mouseenter', () => { infoHovered = true; updateTooltip(); }); button.addEventListener('mouseleave', () => { infoHovered = false; updateTooltip(); });
   button.addEventListener('focus', () => { infoFocused = true; updateTooltip(); }); button.addEventListener('blur', () => { infoFocused = false; updateTooltip(); });
   button.onclick = () => { tooltip.hidden = true; dialog.hidden = false; close.focus(); };
   close.onclick = closeDialog; dialog.onclick = (event) => { if (event.target === dialog) closeDialog(); };
   dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDialog(); });
   wrapper.append(button, tooltip, dialog); return wrapper;
 }
 function displayText(value) { return value ? text(value) : 'Unavailable'; }
function hideErrorToast() { if (errorToastTimer !== undefined) { clearTimeout(errorToastTimer); errorToastTimer = undefined; } error.hidden = true; errorMessage.textContent = ''; }
function showError(message) { if (errorToastTimer !== undefined) clearTimeout(errorToastTimer); errorMessage.textContent = message; error.hidden = false; errorToastTimer = setTimeout(hideErrorToast, 8000); }
$('desktop-error-dismiss').onclick = hideErrorToast;
let currentAuthState = 'signed-out'; let joystickStreamIsLive = false;
function userFacingAuthError(message) { return message === 'Joystick token refresh failed with HTTP 400' ? 'Joystick authentication could not be refreshed, please authenticate again.' : message; }
function renderAuth(snapshot) { const state = snapshot && labels[snapshot.state] ? snapshot.state : 'offline'; currentAuthState = state; const busy = state === 'opening-browser' || state === 'waiting-for-callback'; const connected = state === 'authenticated'; const liveIndicator = $('panel-live-indicator'); if (liveIndicator) { liveIndicator.hidden = !connected; liveIndicator.classList.toggle('live', connected && joystickStreamIsLive); } const joystickButton = $('joystick-connect'); joystickButton.classList.toggle('connected', connected); joystickButton.setAttribute('aria-pressed', String(connected)); joystickButton.setAttribute('aria-label', connected ? 'Disconnect from Joystick' : busy ? 'Cancel Joystick sign-in' : state === 'failure' || state === 'offline' ? 'Retry Joystick sign-in' : 'Connect to Joystick'); const authError = snapshot?.error ? userFacingAuthError(snapshot.error) : undefined; joystickButton.title = authError || labels[state]; if (snapshot?.error) { authErrorMessage = snapshot.error; showError(authError); } else if (authErrorMessage && (connected || state === 'signed-out')) { if (errorMessage.textContent === userFacingAuthError(authErrorMessage)) hideErrorToast(); authErrorMessage = undefined; } }
function renderDevices(devices) { $('devices-empty').hidden = devices.length > 0; $('devices').innerHTML = ''; devices.forEach((device) => { const row = document.createElement('div'); row.className = 'device'; row.innerHTML = '<span><strong>' + displayText(device.deviceName) + '</strong><br><code>' + displayText(device.deviceId) + '</code></span>'; const button = document.createElement('button'); button.className = 'secondary'; button.textContent = 'Revoke'; button.type = 'button'; button.setAttribute('aria-label', 'Revoke ' + device.deviceName); button.onclick = async () => { button.disabled = true; await admin.revokeDevice(device.deviceId); renderDevices(await admin.listDevices()); }; row.append(button); $('devices').append(row); }); }
    function renderStatus(status) { currentStatus = status; $('lan-status').textContent = status.lanEnabled ? 'enabled' : status.state; $('lan-detail').textContent = status.lanEnabled ? 'LAN access is enabled for mobile connection requests.' : 'LAN access is disabled until you enable it.'; $('lan-warning').hidden = status.host !== '0.0.0.0'; $('lan-toggle').textContent = status.lanEnabled ? 'Disable LAN access' : 'Enable LAN access'; $('lan-host').textContent = status.host || 'Not available'; $('advertised-host').textContent = status.advertisedHost || 'Not available'; $('endpoint').textContent = status.baseUrl || 'Not available'; $('protocol').textContent = status.protocol.toUpperCase(); $('discovery').textContent = status.discovery; $('fingerprint').textContent = status.fingerprint || 'Not available'; const statusError = status.discoveryError || status.lanError?.message; if (statusError) { showError(statusError); } $('advertising-retry').hidden = !status.lanEnabled || status.discovery !== 'error'; }
   async function renderInterfaces() { const select = $('advertised-address'); const choices = await admin.listNetworkInterfaces(); select.innerHTML = ''; choices.forEach((choice) => { const option = document.createElement('option'); option.value = choice.address; option.textContent = choice.name + ' · ' + choice.address; option.selected = choice.address === currentStatus?.advertisedHost; select.append(option); }); select.disabled = !choices.length || !currentStatus?.lanEnabled; }
  function renderRequests(requests) { $('requests').innerHTML = ''; if (!requests.length) { $('requests').innerHTML = '<p class="muted">No pending mobile requests.</p>'; return; } requests.forEach((request) => { const row = document.createElement('div'); row.className = 'device'; row.innerHTML = '<span><strong>' + displayText(request.deviceName) + '</strong><br><span class="muted">Confirmation code: </span><code>' + displayText(request.code) + '</code></span>'; const input = document.createElement('input'); input.type = 'text'; input.inputMode = 'text'; input.maxLength = 6; input.placeholder = 'Type code to confirm'; input.setAttribute('aria-label', 'Confirmation code for ' + request.deviceName); const button = document.createElement('button'); button.textContent = 'Confirm code'; button.type = 'button'; button.onclick = async () => { button.disabled = true; try { await admin.approveConnectionRequest(request.requestId, input.value.trim().toUpperCase()); renderRequests(await admin.listConnectionRequests()); } catch (cause) { showError(cause.message || 'Approval failed'); button.disabled = false; } }; row.append(input, button); $('requests').append(row); }); }
 async function refreshRequests() { if (currentStatus?.lanEnabled) renderRequests(await admin.listConnectionRequests()); }
  async function toggleLan() { $('lan-toggle').disabled = true; try { renderStatus(await admin.setLanEnabled(!currentStatus.lanEnabled)); await renderInterfaces(); await refreshRequests(); } catch (cause) { showError(cause.message || 'Unable to change LAN access'); } finally { $('lan-toggle').disabled = false; } }
  async function selectAddress() { try { renderStatus(await admin.setAdvertisedAddress($('advertised-address').value)); await renderInterfaces(); } catch (cause) { showError(cause.message || 'Unable to select advertised address'); } }
  async function retryAdvertising() { try { renderStatus(await admin.retryAdvertising()); } catch (cause) { showError(cause.message || 'Unable to advertise'); } }
   async function signIn() { try { await auth.signInWithJoystick(); } catch (cause) { if (cause.message !== 'authentication cancelled') { showError(cause.message || 'Authentication failed'); } } } async function signOut() { try { await auth.signOut(); } catch (cause) { showError(cause.message || 'Sign out failed'); } }
    const whisperRuleControls = { followed: 'followed', subscribed: 'subscribed', resubscribed: 'resubscribed', giftSender: 'gift-sender' }; let whisperSettings; let whisperSaveQueue = Promise.resolve();
    Object.values(whisperRuleControls).forEach((control) => { const message = $('whisper-' + control + '-message'); const label = message?.previousElementSibling; if (!label?.parentNode || typeof label.parentNode.insertBefore !== 'function') return; const heading = document.createElement('div'); heading.className = 'message-field-heading'; label.parentNode.insertBefore(heading, label); heading.append(label, createMessageVariableInfo('whisper')); });
   function renderWhisperSettings(settings) { whisperSettings = settings; Object.entries(whisperRuleControls).forEach(([rule, control]) => { $('whisper-' + control + '-enabled').checked = settings[rule].enabled; $('whisper-' + control + '-message').value = settings[rule].message; }); }
     function getViewerCount(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0; }
          function renderWhisperStatus(status) { joystickStreamIsLive = status?.stream?.state === 'live'; const liveIndicator = $('panel-live-indicator'); if (liveIndicator) liveIndicator.classList.toggle('live', currentAuthState === 'authenticated' && joystickStreamIsLive); const viewerCount = getViewerCount(status?.stream?.viewerCount); $('panel-viewer-count').textContent = String(viewerCount); }
    function saveWhisperSettings() { if (!whisperSettings) return; const next = {}; Object.entries(whisperRuleControls).forEach(([rule, control]) => { next[rule] = { enabled: $('whisper-' + control + '-enabled').checked, message: $('whisper-' + control + '-message').value }; }); whisperSettings = next; const snapshot = JSON.parse(JSON.stringify(next)); whisperSaveQueue = whisperSaveQueue.then(() => joystickWhispers.updateSettings(snapshot)).then((saved) => { whisperSettings = saved; }).catch((cause) => { showError(cause.message || 'Unable to save whisper settings.'); }); }
   Object.values(whisperRuleControls).forEach((control) => { $('whisper-' + control + '-enabled').onchange = saveWhisperSettings; $('whisper-' + control + '-message').onchange = saveWhisperSettings; });
    let receivedWhisperStatus = false; const removeWhisperStatusListener = joystickWhispers.onStatusChanged((status) => { receivedWhisperStatus = true; renderWhisperStatus(status); }); window.addEventListener('pagehide', removeWhisperStatusListener);
    joystickWhispers.getSettings().then(renderWhisperSettings).catch(() => { showError('Unable to load local whisper settings.'); }); joystickWhispers.getStatus().then((status) => { if (!receivedWhisperStatus) renderWhisperStatus(status); }).catch(() => { if (!receivedWhisperStatus) { renderWhisperStatus({ connection: { state: 'unavailable' }, delivery: { state: 'idle' } }); showError('Unable to load Joystick status.'); } });
   const joystickChatAutomations = window.prismataDesktop.joystickChatAutomations || { getSettings: async () => ({ dropIn: { enabled: false, messages: [] }, slashCommands: { prefix: '!', commands: [] } }), updateSettings: async (settings) => settings }; let dropInChatSettings; let slashCommandSettings = { prefix: '!', commands: [] }; let dropInChatSaveQueue = Promise.resolve();
   function currentDropInMessageValues() { return Array.from($('drop-in-message-list').querySelectorAll('textarea')).map((field) => field.value); }
   function renderDropInMessages(messages) {
     const list = $('drop-in-message-list'); list.replaceChildren();
     const values = (messages.length ? messages : ['']).slice(0, 10);
     values.forEach((message, index) => {
         const row = document.createElement('div'); row.className = 'drop-in-message-row'; row.setAttribute('role', 'listitem');
         const field = document.createElement('div'); field.className = 'drop-in-message-field';
         const label = document.createElement('label'); label.className = 'label'; label.htmlFor = 'drop-in-chat-message-' + index; label.textContent = 'Message ' + (index + 1);
         const heading = document.createElement('div'); heading.className = 'message-field-heading'; heading.append(label, createMessageVariableInfo('drop-in'));
         const textarea = document.createElement('textarea'); textarea.id = label.htmlFor; textarea.rows = 2; textarea.maxLength = 500; textarea.value = message; textarea.setAttribute('aria-label', 'Drop-in chat message ' + (index + 1)); textarea.onchange = saveDropInChatSettings;
         field.append(heading, textarea);
        row.append(field);
        if (index > 0) { const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', 'Remove message ' + (index + 1)); remove.onclick = () => { const next = currentDropInMessageValues(); next.splice(index, 1); renderDropInMessages(next); saveDropInChatSettings(); }; row.append(remove); }
        list.append(row);
     });
     $('drop-in-message-add').disabled = values.length >= 10;
   }
   function saveDropInChatSettings() {
     if (!dropInChatSettings) return;
     const next = { dropIn: { enabled: $('drop-in-chat-enabled').checked, messages: currentDropInMessageValues() }, slashCommands: slashCommandSettings };
      const snapshot = JSON.parse(JSON.stringify(next));
      dropInChatSaveQueue = dropInChatSaveQueue.then(() => joystickChatAutomations.updateSettings(snapshot)).then((saved) => {
        dropInChatSettings = saved; slashCommandSettings = saved.slashCommands || slashCommandSettings; $('drop-in-chat-enabled').checked = saved.dropIn.enabled;
      }).catch((cause) => { showError(cause.message || 'Unable to save Drop-in chat automation.'); });
   }
   $('drop-in-chat-enabled').onchange = saveDropInChatSettings;
   $('drop-in-message-add').onclick = () => { const messages = currentDropInMessageValues(); if (messages.length >= 10) return; messages.push(''); renderDropInMessages(messages); $('drop-in-message-list').querySelectorAll('textarea')[messages.length - 1].focus(); saveDropInChatSettings(); };
   function renderSlashCommandList(commands) {
     const list = $('slash-command-list'); list.replaceChildren();
     commands.forEach((command, index) => {
       const row = document.createElement('div'); row.className = 'drop-in-message-row'; row.setAttribute('role', 'listitem');
       const fields = document.createElement('div'); fields.className = 'drop-in-message-field';
       const nameLabel = document.createElement('label'); nameLabel.className = 'label'; nameLabel.textContent = 'Command name'; nameLabel.htmlFor = 'slash-command-name-' + index;
        const nameField = document.createElement('input'); nameField.id = nameLabel.htmlFor; nameField.type = 'text'; nameField.maxLength = 64; nameField.value = command.name; nameField.setAttribute('aria-label', 'Command name ' + (index + 1));
        const responseLabel = document.createElement('label'); responseLabel.className = 'label'; responseLabel.textContent = 'Public response'; responseLabel.htmlFor = 'slash-command-response-' + index;
        const responseHeading = document.createElement('div'); responseHeading.className = 'message-field-heading'; responseHeading.append(responseLabel, createMessageVariableInfo('slash-command'));
        const textarea = document.createElement('textarea'); textarea.id = responseLabel.htmlFor; textarea.rows = 2; textarea.maxLength = 500; const responseField = textarea; responseField.value = command.response; responseField.setAttribute('aria-label', 'Command response ' + (index + 1));
       nameField.onchange = () => { command.name = nameField.value; saveSlashCommandSettings(); };
       responseField.onchange = () => { command.response = responseField.value; saveSlashCommandSettings(); };
        fields.append(nameLabel, nameField, responseHeading, responseField);
       row.append(fields);
       const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'secondary'; toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-checked', String(command.enabled)); toggle.textContent = command.enabled ? 'Enabled' : 'Disabled';
       toggle.onclick = () => { void toggleSlashCommand(command, toggle); }; row.append(toggle);
       const removeButton = document.createElement('button'); removeButton.type = 'button'; removeButton.className = 'secondary'; removeButton.textContent = 'Delete'; removeButton.setAttribute('aria-label', 'Delete command ' + (index + 1)); removeButton.onclick = () => removeSlashCommand(index); row.append(removeButton);
       list.append(row);
     });
     $('slash-command-add').disabled = commands.length >= 50;
     if (!commands.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'No slash commands yet.'; list.append(empty); }
   }
   function setSlashCommandStatus(message) { $('slash-command-status').textContent = message; }
   function saveSlashCommandSettings() {
     if (!dropInChatSettings) return;
     const prefix = $('slash-command-prefix').value;
     if (!/^\\p{P}$/u.test(prefix)) { const message = 'Use one punctuation character as the command prefix.'; setSlashCommandStatus(message); showError(message); $('slash-command-prefix').value = slashCommandSettings.prefix; return; }
     slashCommandSettings = { prefix, commands: slashCommandSettings.commands };
     const next = { dropIn: { enabled: $('drop-in-chat-enabled').checked, messages: currentDropInMessageValues() }, slashCommands: slashCommandSettings };
     const snapshot = JSON.parse(JSON.stringify(next));
     dropInChatSaveQueue = dropInChatSaveQueue.then(() => joystickChatAutomations.updateSettings(snapshot)).then((saved) => {
       dropInChatSettings = saved; slashCommandSettings = saved.slashCommands || slashCommandSettings; $('slash-command-prefix').value = slashCommandSettings.prefix; renderSlashCommandList(slashCommandSettings.commands); setSlashCommandStatus('');
     }).catch((cause) => { const message = cause.message || 'Unable to save slash-command settings.'; setSlashCommandStatus(message); showError(message); });
   }
   function addSlashCommand() {
     if (slashCommandSettings.commands.length >= 50) return;
     const commands = slashCommandSettings.commands.slice();
     commands.push({ name: '', response: '', enabled: false });
     slashCommandSettings = { ...slashCommandSettings, commands };
     renderSlashCommandList(commands);
     saveSlashCommandSettings();
   }
   function toggleSlashCommand(command, toggle) {
     const enabled = !command.enabled;
     if (enabled && (!command.name.trim() || !command.response.trim())) { const message = 'Enter a command name and response before enabling it.'; setSlashCommandStatus(message); showError(message); return; }
     if (enabled && /\s/.test(command.name.trim())) { const message = 'Use a one-token command name.'; setSlashCommandStatus(message); showError(message); return; }
     command.enabled = enabled;
     toggle.setAttribute('aria-checked', String(enabled));
     toggle.textContent = enabled ? 'Enabled' : 'Disabled';
     saveSlashCommandSettings();
   }
   function removeSlashCommand(index) {
     const commands = slashCommandSettings.commands.slice();
     commands.splice(index, 1);
     slashCommandSettings = { ...slashCommandSettings, commands };
     renderSlashCommandList(commands);
     saveSlashCommandSettings();
   }
   $('slash-command-prefix').onchange = saveSlashCommandSettings;
   $('slash-command-add').onclick = () => addSlashCommand();
    joystickChatAutomations.getSettings().then((settings) => { dropInChatSettings = settings; slashCommandSettings = settings.slashCommands || { prefix: '!', commands: [] }; $('drop-in-chat-enabled').checked = settings.dropIn.enabled; $('slash-command-prefix').value = slashCommandSettings.prefix; renderDropInMessages(settings.dropIn.messages); renderSlashCommandList(slashCommandSettings.commands); }).catch(() => { renderDropInMessages([]); renderSlashCommandList([]); showError('Unable to load Drop-in chat automation.'); });
  const directMessage = window.prismataDesktop.directMessage; let directMessageSending = false;
  async function sendDirectMessage() { if (directMessageSending) return; const button = $('direct-message-send'); const status = $('direct-message-status'); directMessageSending = true; button.disabled = true; status.textContent = 'Sending…'; try { await directMessage.send($('direct-message-input').value); status.textContent = ''; $('direct-message-input').value = ''; } catch (cause) { status.textContent = ''; showError(cause.message || 'Unable to send message'); } finally { directMessageSending = false; button.disabled = false; } }
  const directMessageInput = $('direct-message-input'); if (typeof directMessageInput?.addEventListener === 'function') directMessageInput.addEventListener('keydown', (event) => { if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return; event.preventDefault(); void sendDirectMessage(); });
  const joystickChat = window.prismataDesktop.joystickChat || { list: async () => [], onListChanged: () => () => {} }; let chatListRevision = 0; let chatPageHidden = false;
  function renderChatMessages(messages) { const list = $('joystick-chat-feed'); list.replaceChildren(); if (!messages.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'Waiting for public chat messages…'; list.append(empty); return; } messages.slice(-26).forEach((message) => { const row = document.createElement('div'); row.className = 'chat-message'; row.setAttribute('role', 'listitem'); const author = document.createElement('strong'); author.className = 'chat-message-author'; author.textContent = message.author + ':'; author.style.color = message.authorColor; const body = document.createElement('span'); body.className = 'chat-message-text'; body.textContent = message.text; row.append(author, body); list.append(row); }); list.scrollTop = list.scrollHeight; }
  const unsubscribeJoystickChat = joystickChat.onListChanged((messages) => { chatListRevision += 1; renderChatMessages(messages); });
  window.addEventListener('pagehide', () => { chatPageHidden = true; unsubscribeJoystickChat(); });
  async function loadJoystickChat() { const revision = chatListRevision; try { const messages = await joystickChat.list(); if (!chatPageHidden && revision === chatListRevision) renderChatMessages(messages); } catch { if (!chatPageHidden && revision === chatListRevision) { $('joystick-chat-feed').replaceChildren(); showError('Unable to load live chat.'); } } }
  loadJoystickChat();
  function selectActivityTab(selected) { const historySelected = selected === 'tip-history'; const todoTab = $('todo-tab'); const historyTab = $('tip-history-tab'); todoTab.setAttribute('aria-selected', String(!historySelected)); historyTab.setAttribute('aria-selected', String(historySelected)); todoTab.tabIndex = historySelected ? -1 : 0; historyTab.tabIndex = historySelected ? 0 : -1; $('todo-panel').hidden = historySelected; $('tip-history-panel').hidden = !historySelected; }
   function handleActivityTabKeydown(event) { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 'todo-tab' : event.key === 'End' ? 'tip-history-tab' : event.currentTarget.id === 'todo-tab' ? 'tip-history-tab' : 'todo-tab'; selectActivityTab(next === 'tip-history-tab' ? 'tip-history' : 'todo'); $(next).focus(); }
   $('todo-tab').onclick = () => selectActivityTab('todo'); $('tip-history-tab').onclick = () => { selectActivityTab('tip-history'); $('tip-history-panel').hidden = false; }; $('todo-tab').onkeydown = handleActivityTabKeydown; $('tip-history-tab').onkeydown = handleActivityTabKeydown;
   const tipHistory = window.prismataDesktop.tipHistory || { list: async () => [], onListChanged: () => () => {} }; let tipHistorySnapshotRevision = 0; let tipHistoryPageHidden = false; const tipHistoryPageSize = 15; let tipHistoryCurrentPage = 1; let tipHistoryCurrentSnapshot = [];
    function formatTipHistoryDateTime(value) { const date = new Date(value); if (!Number.isFinite(date.getTime())) return ''; const pad = (part) => String(part).padStart(2, '0'); return pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + '/' + String(date.getFullYear()).slice(-2) + ' - ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()); }
    function renderTipHistory(snapshot) { tipHistoryCurrentSnapshot = snapshot; const pageCount = Math.ceil(snapshot.length / tipHistoryPageSize); tipHistoryCurrentPage = Math.min(tipHistoryCurrentPage, Math.max(1, pageCount)); const pagination = $('tip-history-pagination'); pagination.hidden = pageCount <= 1; $('tip-history-page').textContent = pageCount ? 'Page ' + tipHistoryCurrentPage + ' of ' + pageCount : ''; $('tip-history-previous').disabled = tipHistoryCurrentPage <= 1; $('tip-history-next').disabled = tipHistoryCurrentPage >= pageCount; const list = $('tip-history-list'); list.replaceChildren(); if (!snapshot.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'No tip history yet.'; list.append(empty); return; } snapshot.slice((tipHistoryCurrentPage - 1) * tipHistoryPageSize, tipHistoryCurrentPage * tipHistoryPageSize).forEach((tip) => { const row = document.createElement('div'); row.setAttribute('role', 'listitem'); row.className = 'tip-history-row'; const details = document.createElement('details'); const summary = document.createElement('summary'); const title = document.createElement('span'); title.textContent = tip.title; summary.append(title); const dateTime = tip.occurredAt ? formatTipHistoryDateTime(tip.occurredAt) : ''; if (dateTime) { const date = document.createElement('span'); date.className = 'tip-history-date'; date.textContent = dateTime; summary.append(date); } details.append(summary); if (tip.source) { const source = document.createElement('p'); source.className = 'muted'; source.textContent = 'Source: ' + tip.source; details.append(source); } if (tip.viewer) { const viewer = document.createElement('p'); viewer.className = 'muted'; viewer.textContent = 'Viewer: ' + tip.viewer; details.append(viewer); } if (tip.amount !== undefined) { const amount = document.createElement('p'); amount.className = 'muted'; amount.textContent = 'Amount: ' + String(tip.amount); details.append(amount); } row.append(details); list.append(row); }); }
   $('tip-history-previous').onclick = () => { if (tipHistoryCurrentPage <= 1) return; tipHistoryCurrentPage -= 1; renderTipHistory(tipHistoryCurrentSnapshot); };
   $('tip-history-next').onclick = () => { if (tipHistoryCurrentPage >= Math.ceil(tipHistoryCurrentSnapshot.length / tipHistoryPageSize)) return; tipHistoryCurrentPage += 1; renderTipHistory(tipHistoryCurrentSnapshot); };
   const unsubscribeTipHistory = tipHistory.onListChanged((snapshot) => { tipHistorySnapshotRevision += 1; renderTipHistory(snapshot); });
   window.addEventListener('pagehide', () => { tipHistoryPageHidden = true; unsubscribeTipHistory(); });
    async function loadTipHistory() { const revision = tipHistorySnapshotRevision; try { const snapshot = await tipHistory.list(); if (!tipHistoryPageHidden && revision === tipHistorySnapshotRevision) { renderTipHistory(snapshot); } } catch { if (!tipHistoryPageHidden && revision === tipHistorySnapshotRevision) { $('tip-history-list').replaceChildren(); showError('Unable to load Tip History.'); } } }
   loadTipHistory();
   const todos = window.prismataDesktop.todos; let currentTodos = []; let todoSnapshotRevision = 0; let todoAdding = false; let editingTodoId; let todoPageHidden = false; const completingTodoIds = new Set(); const undoingTodoIds = new Set(); const removingTodoIds = new Set();
   function renderTodos(snapshot) {
     if (editingTodoId) {
       const editedTodo = snapshot.find((todo) => todo.id === editingTodoId);
       if (!editedTodo || editedTodo.completedAt) { editingTodoId = undefined; $('todo-form').reset(); $('todo-status').textContent = 'This TODO is no longer editable.'; }
     }
     currentTodos = snapshot;
    const list = $('todo-list');
    list.replaceChildren();
    if (!snapshot.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'No TODOs yet.'; list.append(empty); return; }
    snapshot.forEach((todo) => {
      const completed = Boolean(todo.completedAt);
      const pending = completingTodoIds.has(todo.id); const removing = removingTodoIds.has(todo.id); const editing = editingTodoId === todo.id;
      const row = document.createElement('div'); row.setAttribute('role', 'listitem'); row.className = 'todo-row';
      if (completed) row.classList.add('todo-completed', 'muted'); else if (pending) row.classList.add('todo-completing', 'muted');
       const details = document.createElement('div'); details.className = 'todo-details'; details.tabIndex = 0;
       const name = document.createElement('strong'); name.textContent = todo.itemName; details.append(name);
       const tooltip = document.createElement('div'); tooltip.className = 'todo-tooltip'; tooltip.id = 'todo-tooltip-' + todo.id; tooltip.setAttribute('role', 'tooltip'); details.setAttribute('aria-describedby', tooltip.id);
         if (todo.source) { const source = document.createElement('p'); source.className = 'muted'; source.textContent = 'Source: ' + todo.source; tooltip.append(source); }
         if (todo.viewer) { const viewer = document.createElement('p'); viewer.className = 'muted'; viewer.textContent = 'Viewer: ' + todo.viewer; tooltip.append(viewer); }
        if (todo.note) { const note = document.createElement('p'); note.textContent = 'Note: ' + todo.note; tooltip.append(note); }
        const created = document.createElement('p'); created.className = 'muted'; created.textContent = 'Added: ' + todo.createdAt; tooltip.append(created);
        if (todo.tokenAmount !== undefined) { const amount = document.createElement('p'); amount.className = 'muted'; amount.textContent = 'Tokens: ' + String(todo.tokenAmount); tooltip.append(amount); }
       details.append(tooltip);
      let expiryTimer;
      if (completed && todo.completedAt) {
        expiryTimer = document.createElement('span'); expiryTimer.className = 'todo-expiry-timer'; expiryTimer.setAttribute('role', 'timer'); expiryTimer.dataset.deadline = String(Date.parse(todo.completedAt) + 30_000); updateTodoExpiryTimer(expiryTimer);
      }
      const actions = document.createElement('div'); actions.className = 'todo-row-actions';
      if (todo.source === 'Manual' && !completed) {
        const editButton = document.createElement('button'); editButton.type = 'button'; editButton.className = 'secondary todo-edit-button'; editButton.innerHTML = editPencilIcon; editButton.setAttribute('aria-label', 'Edit ' + todo.itemName); editButton.title = 'Edit ' + todo.itemName; editButton.disabled = pending || removing; editButton.onclick = () => editTodo(todo); actions.append(editButton);
      }
      if (completed && expiryTimer && Number(expiryTimer.dataset.deadline) > Date.now()) {
        const removeButton = document.createElement('button'); removeButton.type = 'button'; removeButton.className = 'secondary todo-dismiss-button'; removeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="m19 6-1 14H6L5 6"></path><path d="M10 11v5M14 11v5"></path></svg>'; removeButton.setAttribute('aria-label', 'Remove ' + todo.itemName); removeButton.title = editing ? 'Finish editing before removing ' + todo.itemName : 'Remove ' + todo.itemName; removeButton.disabled = removing || editing; removeButton.onclick = () => removeTodo(todo); actions.append(removeButton);
      }
      const undoing = undoingTodoIds.has(todo.id);
       const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary todo-complete-button'; button.textContent = completed ? '↶' : '✓'; const actionLabel = completed ? (undoing ? 'Undoing completion ' : 'Undo completion ') : pending ? 'Completing ' : editing ? 'Finish editing before completing ' : 'Complete '; button.setAttribute('aria-label', actionLabel + todo.itemName); button.title = actionLabel + todo.itemName; button.disabled = completed ? undoing || removing : pending || removing || editing;
      button.onclick = () => completed ? undoCompleteTodo(todo) : completeTodo(todo); actions.append(button);
      row.append(details); if (expiryTimer) row.append(expiryTimer); row.append(actions); list.append(row); if (expiryTimer) updateTodoExpiryTimer(expiryTimer);
    });
  }
  function editTodo(todo) {
    if (todo.source !== 'Manual' || todo.completedAt) return;
    editingTodoId = todo.id;
    $('todo-item-name').value = todo.itemName;
    $('todo-viewer').value = todo.viewer || '';
    $('todo-note').value = todo.note || '';
    $('todo-status').textContent = '';
    $('todo-item-name').focus();
    $('todo-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    renderTodos(currentTodos);
  }
  async function addTodo() {
    if (todoAdding) return;
    const itemName = $('todo-item-name').value.trim();
    if (!itemName) { $('todo-status').textContent = ''; showError('An item name is required.'); $('todo-item-name').focus(); return; }
    const viewer = $('todo-viewer').value.trim(); const note = $('todo-note').value.trim();
    const input = { itemName, ...(viewer ? { viewer } : {}), ...(note ? { note } : {}) };
    const button = $('todo-add'); todoAdding = true; button.disabled = true; $('todo-status').textContent = 'Saving TODO…';
    try {
      if (editingTodoId) await todos.update(editingTodoId, input);
      else {
        const added = await todos.add(input);
        if (!currentTodos.some((todo) => todo.id === added.id)) { todoSnapshotRevision += 1; renderTodos([...currentTodos, added]); }
      }
      editingTodoId = undefined; $('todo-form').reset(); $('todo-status').textContent = ''; if (!todoPageHidden) renderTodos(currentTodos);
    } catch {
      $('todo-status').textContent = ''; showError('Unable to save TODO. Please try again.');
    } finally { todoAdding = false; button.disabled = false; }
  }
  async function completeTodo(todo) {
    if (todo.completedAt || editingTodoId === todo.id || completingTodoIds.has(todo.id)) return;
    completingTodoIds.add(todo.id); renderTodos(currentTodos);
    try { await todos.complete(todo.id); $('todo-status').textContent = 'TODO completed.'; }
    catch { $('todo-status').textContent = ''; showError('Unable to complete TODO. Please try again.'); }
    finally { completingTodoIds.delete(todo.id); if (!todoPageHidden) renderTodos(currentTodos); }
  }
  async function undoCompleteTodo(todo) {
    if (!todo.completedAt || undoingTodoIds.has(todo.id)) return;
    undoingTodoIds.add(todo.id); renderTodos(currentTodos);
    try { await todos.undoComplete(todo.id); $('todo-status').textContent = ''; }
    catch { $('todo-status').textContent = ''; showError('Unable to undo completion. The undo timer may have expired.'); }
    finally { undoingTodoIds.delete(todo.id); if (!todoPageHidden) renderTodos(currentTodos); }
  }
  async function removeTodo(todo) {
    if (editingTodoId === todo.id) return;
    if (!todo.completedAt || Date.parse(todo.completedAt) + 30_000 <= Date.now() || removingTodoIds.has(todo.id)) return;
    removingTodoIds.add(todo.id); renderTodos(currentTodos);
    try { await todos.remove(todo.id); $('todo-status').textContent = ''; }
    catch { $('todo-status').textContent = ''; showError('Unable to remove TODO. Please try again.'); }
    finally { removingTodoIds.delete(todo.id); if (!todoPageHidden) renderTodos(currentTodos); }
  }
  function updateTodoExpiryTimer(timer) {
    const remainingMs = Number(timer.dataset.deadline) - Date.now();
    const seconds = Math.ceil(Math.max(0, remainingMs) / 1000);
    timer.textContent = seconds + 's';
    timer.setAttribute('aria-label', 'Expires in ' + seconds + ' seconds');
    timer.closest('.todo-row')?.querySelectorAll('button.todo-dismiss-button, button.todo-complete-button').forEach((button) => { button.hidden = remainingMs <= 0; });
  }
  function updateTodoExpiryTimers() { document.querySelectorAll('.todo-expiry-timer').forEach(updateTodoExpiryTimer); }
  const todoExpiryInterval = setInterval(updateTodoExpiryTimers, 1000);
  const unsubscribeTodos = todos.onListChanged((snapshot) => { todoSnapshotRevision += 1; renderTodos(snapshot); $('todo-status').textContent = 'TODO list updated.'; });
  window.addEventListener('pagehide', () => { todoPageHidden = true; unsubscribeTodos(); clearInterval(todoExpiryInterval); });
  async function loadTodos() {
    const revision = todoSnapshotRevision;
    try {
      const snapshot = await todos.list();
      if (!todoPageHidden && revision === todoSnapshotRevision) { renderTodos(snapshot); $('todo-status').textContent = ''; }
    } catch {
      if (!todoPageHidden && revision === todoSnapshotRevision) {
        $('todo-list').replaceChildren(); $('todo-status').textContent = ''; showError('Unable to load TODOs. Please try again.');
      }
    }
  }
  $('todo-add').onclick = addTodo; $('todo-form').onsubmit = (event) => { event.preventDefault(); addTodo(); }; loadTodos();
  const reminder = window.prismataDesktop.reminder; let editingReminderId; let editingReminderEnabled = false;
     function setReminderMessageVisibility(task) { const visible = task === 'custom-message'; $('reminder-message-controls').hidden = !visible; }
      function currentReminderMessages() { return Array.from($('reminder-message-list').querySelectorAll('textarea'), (field) => field.value); }
      function renderReminderMessages(messages) { const list = $('reminder-message-list'); list.replaceChildren(); const values = (messages.length ? messages : ['']).slice(0, 10); values.forEach((message, index) => { const row = document.createElement('div'); row.className = 'drop-in-message-row'; row.setAttribute('role', 'listitem'); const field = document.createElement('div'); field.className = 'drop-in-message-field'; const label = document.createElement('label'); label.className = 'label'; label.htmlFor = 'reminder-message-' + index; label.textContent = 'Message ' + (index + 1); const textarea = document.createElement('textarea'); textarea.id = label.htmlFor; textarea.rows = 2; textarea.maxLength = 500; textarea.value = message; textarea.setAttribute('aria-label', 'Reminder message ' + (index + 1)); field.append(label, textarea); row.append(field); if (index > 0) { const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', 'Remove reminder message ' + (index + 1)); remove.onclick = () => { const next = currentReminderMessages(); next.splice(index, 1); renderReminderMessages(next); }; row.append(remove); } list.append(row); }); $('reminder-message-add').disabled = values.length >= 10; }
       function renderReminder(settings) { $('reminder-task').value = settings.task; renderReminderMessages(settings.messages?.length ? settings.messages : [settings.message]); setReminderMessageVisibility(settings.task); $('reminder-schedule').value = settings.schedule; $('reminder-interval').value = settings.intervalMinutes; $('reminder-interval-controls').hidden = settings.schedule !== 'interval'; $('reminder-time').value = settings.dailyTime; $('reminder-time').hidden = settings.schedule !== 'daily'; $('reminder-time-label').hidden = settings.schedule !== 'daily'; }
      function reminderFormSettings() { const messages = currentReminderMessages().map((message) => message.trim()).filter(Boolean); const task = $('reminder-task').value; if (task === 'custom-message' && !messages.length) throw new Error('Add at least one custom message.'); return { enabled: editingReminderEnabled, task, message: messages[0] || 'Flip a Coin', messages, schedule: $('reminder-schedule').value, intervalMinutes: Number($('reminder-interval').value), dailyTime: $('reminder-time').value }; }
      function scheduleLabel(record) { return record.schedule === 'daily' ? 'Daily at ' + record.dailyTime : record.schedule === 'hourly' ? 'Every hour' : 'Every ' + record.intervalMinutes + ' minutes'; }
      const reminderIcons = { edit: editPencilIcon, delete: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="m19 6-1 14H6L5 6"></path><path d="M10 11v5M14 11v5"></path></svg>', send: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path></svg>' };
      function createReminderIconButton(icon, label, action) { const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary reminder-icon-button reminder-' + icon + '-button'; button.setAttribute('aria-label', label); button.title = label; button.innerHTML = reminderIcons[icon]; button.onclick = action; return button; }
      function reminderSummary(record) { const messageCount = record.messages?.length || 0; return record.task === 'coin-flip' ? 'Flip a coin' : messageCount > 1 ? messageCount + ' messages · round robin' : record.message || 'Unavailable'; }
      async function toggleReminder(record, button) { button.disabled = true; const enabled = !record.enabled; try { await reminder.updateRecord(record.id, { ...record, enabled }); record.enabled = enabled; button.setAttribute('aria-checked', String(enabled)); button.setAttribute('aria-label', (enabled ? 'Disable' : 'Enable') + ' reminder: ' + reminderSummary(record)); button.title = button.getAttribute('aria-label'); const metadata = button.closest('.reminder-row')?.querySelector('.reminder-main .muted'); if (metadata) metadata.textContent = scheduleLabel(record); if (!(await loadReminder())) button.disabled = false; } catch (cause) { showError(cause.message || 'Unable to update reminder'); button.disabled = false; } }
      function renderReminderList(records) { const list = $('reminder-list'); list.replaceChildren(); if (!records.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'No reminders yet. Add one to get started.'; list.append(empty); return; } records.forEach((record) => { const row = document.createElement('div'); row.className = 'device reminder-row'; row.setAttribute('role', 'listitem'); const summary = reminderSummary(record); const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'reminder-toggle'; toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-checked', String(record.enabled)); toggle.setAttribute('aria-label', (record.enabled ? 'Disable' : 'Enable') + ' reminder: ' + summary); toggle.title = toggle.getAttribute('aria-label'); const thumb = document.createElement('span'); thumb.className = 'reminder-toggle-thumb'; thumb.setAttribute('aria-hidden', 'true'); toggle.append(thumb); toggle.onclick = () => { void toggleReminder(record, toggle); }; const details = document.createElement('span'); details.className = 'reminder-main'; const title = document.createElement('strong'); title.textContent = summary; const metadata = document.createElement('span'); metadata.className = 'muted'; metadata.textContent = scheduleLabel(record); details.append(title, document.createElement('br'), metadata); const actions = document.createElement('span'); actions.className = 'reminder-actions'; actions.append(createReminderIconButton('edit', 'Edit reminder: ' + summary, () => openReminder(record)), createReminderIconButton('delete', 'Delete reminder: ' + summary, () => deleteReminder(record.id)), createReminderIconButton('send', 'Send test reminder: ' + summary, () => testReminderForId(record.id))); row.append(toggle, details, actions); list.append(row); }); }
        function openReminder(settings) { editingReminderId = settings?.id; editingReminderEnabled = settings?.enabled === true; renderReminder(settings || { enabled: false, task: 'custom-message', message: '', schedule: 'hourly', intervalMinutes: 5, dailyTime: '09:00' }); $('reminder-editor').hidden = false; $('reminder-editor-heading').textContent = settings ? 'Edit reminder' : 'Add reminder'; }
      function closeReminderEditor() { editingReminderId = undefined; editingReminderEnabled = false; $('reminder-editor').hidden = true; $('reminder-status').textContent = ''; }
      async function loadReminder() { try { const records = await reminder.list(); renderReminderList(records); return true; } catch (cause) { showError(cause.message || 'Unable to load reminder settings'); return false; } }
      async function saveReminder() { const button = $('reminder-save'); button.disabled = true; try { if (editingReminderId) await reminder.updateRecord(editingReminderId, reminderFormSettings()); else await reminder.create(reminderFormSettings()); $('reminder-status').textContent = 'Reminder saved.'; $('reminder-editor').hidden = true; await loadReminder(); } catch (cause) { showError(cause.message || 'Unable to save reminder'); } finally { button.disabled = false; } }
      async function testReminderForId(id) { try { await reminder.testRecord(id); } catch (cause) { showError(cause.message || 'Unable to send reminder'); } }

       async function deleteReminder(id) { if (!confirm('Delete this reminder?')) return; try { await reminder.remove(id); if (editingReminderId === id) closeReminderEditor(); await loadReminder(); } catch (cause) { showError(cause.message || 'Unable to delete reminder'); } }
         $('direct-message-send').onclick = sendDirectMessage; $('joystick-connect').onclick = () => currentAuthState === 'authenticated' ? signOut() : currentAuthState === 'opening-browser' || currentAuthState === 'waiting-for-callback' ? auth.cancel() : signIn(); $('lan-toggle').onclick = toggleLan; $('advertised-address').onchange = selectAddress; $('advertising-retry').onclick = retryAdvertising; $('reminder-add').onclick = () => openReminder(); $('reminder-save').onclick = saveReminder; $('reminder-cancel').onclick = closeReminderEditor; $('reminder-task').onchange = () => setReminderMessageVisibility($('reminder-task').value); $('reminder-message-add').onclick = () => { const messages = currentReminderMessages(); if (messages.length >= 10) return; messages.push(''); renderReminderMessages(messages); $('reminder-message-list').querySelectorAll('textarea')[messages.length - 1].focus(); }; $('reminder-schedule').onchange = () => { $('reminder-interval-controls').hidden = $('reminder-schedule').value !== 'interval'; $('reminder-time').hidden = $('reminder-schedule').value !== 'daily'; $('reminder-time-label').hidden = $('reminder-schedule').value !== 'daily'; };
    admin.getStatus().then(async (status) => { renderStatus(status); await renderInterfaces(); renderDevices(await admin.listDevices()); await refreshRequests(); setInterval(refreshRequests, 2000); }).catch(() => { $('lan-status').textContent = 'unavailable'; showError('Unable to load LAN status.'); }); loadReminder(); auth.onStateChanged(renderAuth); auth.getSnapshot().then(renderAuth).catch(() => renderAuth({ state: 'offline', error: 'Unable to read authentication state.' })); })();
</script></body></html>`;
}
