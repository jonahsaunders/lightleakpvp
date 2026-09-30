// Player settings: stored in this browser, applied immediately, shown on the title screen.
import { setVolume } from './audio.js';

const KEY = 'lightleakpvp.settings';
export const SET = {
  sens: 1, fov: 75, invertY: false,
  master: 0.9, sfx: 1, voice: 0.9, music: 0.5, ambience: 0.6,
  flashing: 'full', shake: true, subs: 'normal',
};
try { Object.assign(SET, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* defaults */ }

function save() { try { localStorage.setItem(KEY, JSON.stringify(SET)); } catch (e) { /* ignore */ } }

export function applySettings() {
  for (const k of ['master', 'sfx', 'voice', 'music', 'ambience']) setVolume(k, SET[k]);
  document.body.classList.toggle('subs-large', SET.subs === 'large');
  document.body.classList.toggle('calm-flash', SET.flashing === 'reduced');
}

// Builds the settings panel inside `el`.
export function settingsPanel(el) {
  const range = (key, label, min, max, step) => `<label>${label}<input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${SET[key]}"><output>${fmt(key)}</output></label>`;
  const check = (key, label) => `<label>${label}<input type="checkbox" data-k="${key}" ${SET[key] ? 'checked' : ''}></label>`;
  const pick = (key, label, opts) => `<label>${label}<select data-k="${key}">${opts.map(([v, t]) => `<option value="${v}" ${SET[key] === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
  el.innerHTML = `
    <div class="set-col"><div class="set-h">CONTROLS</div>
      ${range('sens', 'Mouse sensitivity', 0.3, 2.5, 0.05)}
      ${range('fov', 'Field of view', 60, 100, 1)}
      ${check('invertY', 'Invert look')}
      <div class="set-note">Gamepads work too: left stick move, right stick look, LT camera, RT shoot or develop, bumpers change photo or frame, A jump, X film, Y throw away, D-pad turn photo, Back scores.</div>
    </div>
    <div class="set-col"><div class="set-h">SOUND</div>
      ${range('master', 'Master', 0, 1, 0.05)}${range('sfx', 'Effects', 0, 1, 0.05)}${range('music', 'Music', 0, 1, 0.05)}${range('ambience', 'Room tone', 0, 1, 0.05)}
    </div>
    <div class="set-col"><div class="set-h">COMFORT</div>
      ${pick('flashing', 'Camera flashes', [['full', 'Full'], ['reduced', 'Reduced']])}
      ${check('shake', 'Screen shake')}
    </div>`;
  el.querySelectorAll('[data-k]').forEach(inp => inp.addEventListener('input', () => {
    const k = inp.dataset.k;
    SET[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? Number(inp.value) : inp.value;
    const out = inp.parentElement.querySelector('output');
    if (out) out.textContent = fmt(k);
    save(); applySettings();
  }));
}
function fmt(k) {
  const v = SET[k];
  if (k === 'fov') return `${v}°`;
  if (k === 'sens') return v.toFixed(2);
  return `${Math.round(v * 100)}%`;
}
