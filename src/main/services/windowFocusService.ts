import { execFile } from 'child_process';

/**
 * Bring the Unreal Editor application window to the foreground.
 *
 * macOS: `osascript` activates by app name. We try a handful of known bundle
 *        names (UnrealEditor on UE5, UE4Editor on UE4). No Accessibility
 *        permission required for `activate`.
 *
 * Windows: PowerShell one-liner uses `SetForegroundWindow` via inline P/Invoke
 *          against the first `UnrealEditor`/`UE4Editor` process found.
 *          No elevation / UAC prompt.
 *
 * Returns true if the focus attempt completed without throwing. Does not
 * guarantee a specific sub-panel inside UE is active — only that the process
 * window is frontmost.
 */
export async function focusUnrealEditor(): Promise<boolean> {
  if (process.platform === 'darwin') return focusMac();
  if (process.platform === 'win32') return focusWindows();
  return false;
}

function focusMac(): Promise<boolean> {
  const candidates = ['UnrealEditor', 'Unreal Editor', 'UE4Editor', 'UnrealGame'];
  const script = candidates
    .map(
      (name) =>
        `try
  if application "${name}" is running then
    tell application "${name}" to activate
    return "ok"
  end if
end try`,
    )
    .join('\n');

  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 3000 }, (err, stdout) => {
      if (err) {
        console.warn('[windowFocus] mac osascript failed:', err.message);
        resolve(false);
        return;
      }
      resolve((stdout || '').trim() === 'ok');
    });
  });
}

function focusWindows(): Promise<boolean> {
  const ps = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Focus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@
  $names = @('UnrealEditor','UE4Editor','UnrealGame')
  foreach ($n in $names) {
    $p = Get-Process -Name $n -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($p) {
      $h = $p.MainWindowHandle
      if ([Win32Focus]::IsIconic($h)) { [Win32Focus]::ShowWindow($h, 9) | Out-Null }
      [Win32Focus]::SetForegroundWindow($h) | Out-Null
      Write-Output 'ok'
      exit 0
    }
  }
  Write-Output 'no-proc'
} catch {
  Write-Output "err:$($_.Exception.Message)"
}
`;
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { timeout: 5000 },
      (err, stdout) => {
        if (err) {
          console.warn('[windowFocus] windows powershell failed:', err.message);
          resolve(false);
          return;
        }
        const out = (stdout || '').trim();
        if (out !== 'ok') {
          console.warn('[windowFocus] windows result:', out);
        }
        resolve(out === 'ok');
      },
    );
  });
}
