// "Start with Windows": a Task Scheduler task that runs the launcher when the user signs in.
// (Windows holds back Startup-folder apps for a few minutes after sign-in; a sign-in task runs straight away.)
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const TASK = 'Corsair Control';
const launcher = path.resolve(__dirname, '..', 'Corsair Control.vbs');
// the old way this option worked, removed when it is turned on or off
const oldEntry = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Corsair Control.vbs');

function ps(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
}
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// Checking for the task takes a moment, so it is done in the background and the last answer is reused.
let cached = null, checking = false;
function refresh() {
  if (checking) return;
  checking = true;
  execFile('schtasks.exe', ['/Query', '/TN', TASK], { windowsHide: true }, (err) => { cached = !err; checking = false; });
}
function check() {
  try { execFileSync('schtasks.exe', ['/Query', '/TN', TASK], { windowsHide: true, stdio: 'ignore' }); cached = true; } catch (e) { cached = false; }
  return cached;
}
function isEnabled() {
  if (cached === null) return check();
  refresh();
  return cached;
}

function setEnabled(on) {
  try { fs.unlinkSync(oldEntry); } catch (e) { /* not there */ }
  if (on) {
    ps(`$u = "$env:USERDOMAIN\\$env:USERNAME"
      $a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ${q('"' + launcher + '" startup')} -WorkingDirectory ${q(path.dirname(launcher))}
      $t = New-ScheduledTaskTrigger -AtLogOn -User $u
      $p = New-ScheduledTaskPrincipal -UserId $u -LogonType Interactive -RunLevel Limited
      $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
      Register-ScheduledTask -TaskName ${q(TASK)} -Description 'Starts Corsair Control when you sign in. Switch this off in the app.' -Action $a -Trigger $t -Principal $p -Settings $s -Force -ErrorAction Stop | Out-Null`);
  } else {
    try { ps(`Unregister-ScheduledTask -TaskName ${q(TASK)} -Confirm:$false -ErrorAction Stop`); } catch (e) { /* already off */ }
  }
  return check();
}

// Someone who turned this on before it used a sign-in task still has the old Startup-folder entry: move them over.
function migrate() {
  if (!fs.existsSync(oldEntry)) return;
  try { setEnabled(true); } catch (e) { console.error('start with Windows:', e.message); }
}

module.exports = { isEnabled, setEnabled, migrate };
