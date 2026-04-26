export async function copyT3DText(text: string): Promise<boolean> {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  try {
    await navigator.clipboard.writeText(normalized);
    return true;
  } catch {
    try {
      const ok = await window.electronAPI?.clipboard?.writeText(normalized);
      return Boolean(ok);
    } catch {
      return false;
    }
  }
}
