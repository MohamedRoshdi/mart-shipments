import * as db from './db.js';

const $ = (id) => document.getElementById(id);

function show(id) {
  document.querySelectorAll('main > section').forEach(s => s.hidden = true);
  $(id).hidden = false;
}

function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

function myName() { return localStorage.getItem('employeeName'); }

function toast(msg) {
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), 2000);
}

async function goHome() {
  show('screen-home');
}

$('save-name').onclick = () => {
  const n = $('employee-name').value.trim();
  if (!n) return;
  localStorage.setItem('employeeName', n);
  goHome();
};

document.querySelectorAll('.btn-back').forEach(b => b.onclick = goHome);

(async () => {
  await db.initDb().catch(console.error);
  if (myName()) goHome(); else show('screen-name');
})();
