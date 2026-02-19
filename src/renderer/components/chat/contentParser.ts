// Shared content parser for both MessageBubble and StreamingMessage
// Handles YouTube embeds and documentation image markers in a single pass

export type ContentPart =
  | { type: 'text'; content: string }
  | { type: 'youtube'; videoId: string; title: string }
  | { type: 'docimage'; query: string };

const COMBINED_PATTERN = /\[\[YOUTUBE:([a-zA-Z0-9_-]+):([^\]]+)\]\]|\[\[DOC_IMAGE:([^\]]+)\]\]/g;

export function parseContentParts(content: string): ContentPart[] {
  const parts: ContentPart[] = [];
  let lastIndex = 0;
  let match;

  const regex = new RegExp(COMBINED_PATTERN);
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    }

    if (match[1] && match[2]) {
      // YouTube embed: [[YOUTUBE:VIDEO_ID:Title]]
      parts.push({ type: 'youtube', videoId: match[1], title: match[2] });
    } else if (match[3]) {
      // Doc image: [[DOC_IMAGE:query]]
      parts.push({ type: 'docimage', query: match[3] });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', content: content.slice(lastIndex) });
  }

  return parts;
}
