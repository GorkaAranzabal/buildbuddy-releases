export interface DetectedSteps {
  steps: string[];
  rawContent: string;
}

const NUMBERED_STEP_RE = /^\s*(\d+)\.\s+(.+)/gm;

/**
 * Detects numbered step-by-step instructions in AI response text.
 * Returns parsed steps when 3+ sequential numbered items are found,
 * otherwise returns null so the response renders as normal chat.
 *
 * Each "step" captures everything from the number prefix through
 * the end of its block (including continuation lines before the next number).
 */
/**
 * Early-intent check: returns true as soon as the streaming text contains a
 * "1." list item on its own line, indicating a multi-step response is being
 * generated. Used to flip into "Preparing guided steps…" before the reveal
 * timer would show the raw streaming text.
 */
export function hasEarlyStepIntent(content: string): boolean {
  return /(?:^|\n)\s*1\.\s+\S/.test(content);
}

export function detectSteps(content: string): DetectedSteps | null {
  const lines = content.split('\n');
  const stepEntries: { num: number; startIdx: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*(\d+)\.\s+/);
    if (match) {
      stepEntries.push({ num: parseInt(match[1], 10), startIdx: i });
    }
  }

  if (stepEntries.length < 3) return null;

  // Find the FIRST sequential run of 3+ items starting from 1.
  // Multi-round MCP responses can contain multiple numbered lists (e.g. the AI
  // gives steps 1-3, calls tools, then summarises as 1-2 again). The old
  // "all entries must be sequential" check fails in that case, so we scan for
  // the first valid run instead.
  let runStart = 0;
  while (runStart < stepEntries.length) {
    if (stepEntries[runStart].num !== 1) {
      runStart++;
      continue;
    }
    // Found a '1.' — measure the length of the sequential run
    let runLen = 1;
    while (
      runStart + runLen < stepEntries.length &&
      stepEntries[runStart + runLen].num === runLen + 1
    ) {
      runLen++;
    }
    if (runLen >= 3) {
      const runEntries = stepEntries.slice(runStart, runStart + runLen);
      const steps: string[] = runEntries.map((entry, idx) => {
        const startLine = entry.startIdx;
        const endLine =
          idx < runLen - 1 ? runEntries[idx + 1].startIdx : lines.length;
        const block = lines.slice(startLine, endLine).join('\n').trim();
        return block.replace(/^\s*\d+\.\s+/, '');
      });
      return { steps, rawContent: content };
    }
    runStart++;
  }

  return null;
}
