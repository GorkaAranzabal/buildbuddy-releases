import type {
  ParseResult,
  ParsedGraph,
  ParsedNode,
  ParsedEdge,
  ParsedComment,
  ParsedPin,
  PinType,
} from './types';
import { classifyNode, headerColorFor, prettyNodeTitle, CATEGORY_COLORS } from './categoryMap';
import { classifyPin } from './pinTypes';

interface RawObject {
  className: string;
  name: string;
  props: Map<string, string>;
  pinLines: string[];
  depth: number;
}

interface LinkRef {
  fromNode: string;
  fromPin: string;
  toNode: string;
  toPin: string;
}

export function parseT3D(text: string): ParseResult {
  try {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const topObjects = collectTopObjects(lines);
    if (topObjects.length === 0) {
      return { ok: false, reason: 'No Begin Object blocks found.' };
    }

    const nodes: ParsedNode[] = [];
    const comments: ParsedComment[] = [];
    const pinIndex = new Map<string, Map<string, ParsedPin>>();
    const links: LinkRef[] = [];

    for (const obj of topObjects) {
      const cat = classifyNode(obj.className);
      if (cat === 'Comment') {
        comments.push(buildComment(obj));
        continue;
      }
      const { node, pins, nodeLinks } = buildNode(obj);
      nodes.push(node);
      pinIndex.set(node.id, pins);
      links.push(...nodeLinks);
    }

    const edges = resolveEdges(links, pinIndex, nodes);
    const graph: ParsedGraph = { nodes, edges, comments };
    return { ok: true, graph };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  }
}

function collectTopObjects(lines: string[]): RawObject[] {
  const out: RawObject[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const beginMatch = /^\s*Begin Object\b/.exec(line);
    if (!beginMatch) {
      i++;
      continue;
    }
    const { obj, endIdx } = readObject(lines, i, 0);
    if (obj) out.push(obj);
    i = endIdx + 1;
  }
  return out;
}

function readObject(
  lines: string[],
  startIdx: number,
  depth: number,
): { obj: RawObject | null; endIdx: number } {
  const header = lines[startIdx];
  const className = extractAttr(header, 'Class') ?? '';
  const name = extractAttr(header, 'Name') ?? `Unnamed_${startIdx}`;

  const props = new Map<string, string>();
  const pinLines: string[] = [];
  const skipComposite = /K2Node_Composite\b/.test(className);
  let i = startIdx + 1;
  let currentDepth = 1;

  while (i < lines.length && currentDepth > 0) {
    const line = lines[i];
    if (/^\s*Begin Object\b/.test(line)) {
      if (skipComposite) {
        const { endIdx } = readObject(lines, i, depth + 1);
        i = endIdx + 1;
        continue;
      }
      currentDepth++;
      i++;
      continue;
    }
    if (/^\s*End Object\b/.test(line)) {
      currentDepth--;
      i++;
      continue;
    }

    const pinStart = /^\s*CustomProperties Pin \(/.exec(line);
    if (pinStart) {
      const { fullLine, endIdx } = absorbParenthesized(lines, i);
      pinLines.push(fullLine);
      i = endIdx + 1;
      continue;
    }

    const eq = line.indexOf('=');
    if (eq > 0) {
      const key = line.slice(0, eq).trim();
      const rawVal = line.slice(eq + 1);
      let value = rawVal;
      if (/^\s*\(/.test(rawVal) && !isBalanced(rawVal)) {
        const { fullLine, endIdx } = absorbParenthesized(lines, i, eq + 1);
        value = fullLine.slice(fullLine.indexOf('=') + 1);
        i = endIdx + 1;
        props.set(key, value.trim());
        continue;
      }
      props.set(key, rawVal.trim());
    }
    i++;
  }

  return {
    obj: { className, name, props, pinLines, depth },
    endIdx: i - 1,
  };
}

function absorbParenthesized(
  lines: string[],
  startIdx: number,
  offset = 0,
): { fullLine: string; endIdx: number } {
  let buf = lines[startIdx];
  let depth = countBalance(buf.slice(offset));
  let i = startIdx;
  while (depth > 0 && i + 1 < lines.length) {
    i++;
    buf += '\n' + lines[i];
    depth += countBalance(lines[i]);
  }
  return { fullLine: buf, endIdx: i };
}

function countBalance(s: string): number {
  let n = 0;
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== '\\') inQuote = !inQuote;
    if (inQuote) continue;
    if (c === '(') n++;
    else if (c === ')') n--;
  }
  return n;
}

function isBalanced(s: string): boolean {
  return countBalance(s) === 0;
}

function extractAttr(line: string, key: string): string | undefined {
  const re = new RegExp(`${key}=("([^"]*)"|([^\\s]+))`);
  const m = re.exec(line);
  if (!m) return undefined;
  return m[2] ?? m[3];
}

function buildNode(obj: RawObject): {
  node: ParsedNode;
  pins: Map<string, ParsedPin>;
  nodeLinks: LinkRef[];
} {
  const x = parseFloat(obj.props.get('NodePosX') ?? '0') || 0;
  const y = parseFloat(obj.props.get('NodePosY') ?? '0') || 0;
  const title = deriveTitle(obj);
  const category = classifyNode(obj.className);
  const headerColor = headerColorFor(obj.className);
  const collapsed = /K2Node_Composite\b/.test(obj.className);

  const inputs: ParsedPin[] = [];
  const outputs: ParsedPin[] = [];
  const pins = new Map<string, ParsedPin>();
  const nodeLinks: LinkRef[] = [];

  for (const pinLine of obj.pinLines) {
    const parsed = parsePinLine(pinLine);
    if (!parsed) continue;
    const pin: ParsedPin = {
      id: parsed.pinId,
      name: parsed.pinName,
      type: parsed.type,
      direction: parsed.direction,
      isExec: parsed.type === 'exec',
      subCategory: parsed.subCategory,
      subCategoryObject: parsed.subCategoryObject,
      defaultValue: parsed.defaultValue,
      defaultObject: parsed.defaultObject,
    };
    pins.set(pin.id, pin);
    if (pin.direction === 'input') inputs.push(pin);
    else outputs.push(pin);
    for (const link of parsed.linkedTo) {
      if (pin.direction === 'output') {
        nodeLinks.push({
          fromNode: obj.name,
          fromPin: pin.id,
          toNode: link.node,
          toPin: link.pin,
        });
      } else {
        nodeLinks.push({
          fromNode: link.node,
          fromPin: link.pin,
          toNode: obj.name,
          toPin: pin.id,
        });
      }
    }
  }

  const rawProps: Record<string, string> = {};
  for (const [k, v] of obj.props) rawProps[k] = v;

  const node: ParsedNode = {
    id: obj.name,
    title,
    className: obj.className,
    category,
    headerColor,
    x,
    y,
    inputs,
    outputs,
    collapsed,
    rawProps,
  };
  return { node, pins, nodeLinks };
}

function deriveTitle(obj: RawObject): string {
  const fnRef = obj.props.get('FunctionReference');
  if (fnRef) {
    const member = /MemberName="?([^",)]+)"?/.exec(fnRef);
    if (member) return member[1];
  }
  const varRef = obj.props.get('VariableReference');
  if (varRef) {
    const member = /MemberName="?([^",)]+)"?/.exec(varRef);
    if (member) {
      const isSet = /K2Node_VariableSet\b/.test(obj.className);
      return (isSet ? 'Set ' : 'Get ') + member[1];
    }
  }
  const input = obj.props.get('InputActionName') ?? obj.props.get('InputKey');
  if (input) return stripQuotes(input);
  const eventRef = obj.props.get('EventReference');
  if (eventRef) {
    const member = /MemberName="?([^",)]+)"?/.exec(eventRef);
    if (member) return member[1];
  }
  const customName = obj.props.get('CustomFunctionName');
  if (customName) return stripQuotes(customName);
  return prettyNodeTitle(obj.className, obj.name);
}

function stripQuotes(s: string): string {
  return s.replace(/^"|"$/g, '');
}

interface ParsedPinInfo {
  pinId: string;
  pinName: string;
  type: PinType;
  direction: 'input' | 'output';
  linkedTo: { node: string; pin: string }[];
  subCategory?: string;
  subCategoryObject?: string;
  defaultValue?: string;
  defaultObject?: string;
}

function parsePinLine(line: string): ParsedPinInfo | null {
  const open = line.indexOf('(');
  if (open < 0) return null;
  const inner = line.slice(open + 1, line.lastIndexOf(')'));
  const fields = splitTopLevelFields(inner);
  const get = (k: string) => fields.get(k);

  const pinName = stripQuotes(get('PinName') ?? '');
  if (!pinName) return null;
  // Real UE5 T3D uses a 32-char hex PinId GUID. Fall back to pinName for
  // legacy/hand-authored snippets so the parser still produces a graph.
  const pinId = stripQuotes(get('PinId') ?? '') || pinName;
  const direction = (stripQuotes(get('Direction') ?? 'EGPD_Input') === 'EGPD_Output')
    ? 'output'
    : 'input';
  const pinCategory = stripQuotes(get('PinType.PinCategory') ?? '');
  const type = classifyPin(pinCategory);
  const subCategory = stripQuotes(get('PinType.PinSubCategory') ?? '') || undefined;
  const subCategoryObject = stripQuotes(get('PinType.PinSubCategoryObject') ?? '') || undefined;
  const defaultValue =
    stripQuotes(get('DefaultValue') ?? '') ||
    stripQuotes(get('AutogeneratedDefaultValue') ?? '') ||
    undefined;
  const defaultObject = stripQuotes(get('DefaultObject') ?? '') || undefined;

  const linkedToRaw = get('LinkedTo');
  const linkedTo: { node: string; pin: string }[] = [];
  if (linkedToRaw) {
    const trimmed = linkedToRaw.trim().replace(/^\(/, '').replace(/\)$/, '');
    const entries = splitTopLevelCommas(trimmed);
    for (const entry of entries) {
      const m = /([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)/.exec(entry.trim());
      if (m) linkedTo.push({ node: m[1], pin: m[2] });
    }
  }

  return {
    pinId,
    pinName,
    type,
    direction,
    linkedTo,
    subCategory,
    subCategoryObject,
    defaultValue,
    defaultObject,
  };
}

function splitTopLevelFields(s: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = splitTopLevelCommas(s);
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    out.set(key, val);
  }
  return out;
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inQuote = false;
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== '\\') inQuote = !inQuote;
    if (!inQuote) {
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ',' && depth === 0) {
        out.push(buf);
        buf = '';
        continue;
      }
    }
    buf += c;
  }
  if (buf.trim().length) out.push(buf);
  return out;
}

function buildComment(obj: RawObject): ParsedComment {
  const x = parseFloat(obj.props.get('NodePosX') ?? '0') || 0;
  const y = parseFloat(obj.props.get('NodePosY') ?? '0') || 0;
  const w = parseFloat(obj.props.get('NodeWidth') ?? '400') || 400;
  const h = parseFloat(obj.props.get('NodeHeight') ?? '200') || 200;
  const text = stripQuotes(obj.props.get('NodeComment') ?? 'Comment');
  const tint = parseCommentTint(obj.props.get('CommentColor')) ?? CATEGORY_COLORS.Comment;
  return { id: `c_${obj.name}`, x, y, w, h, text, tint };
}

function parseCommentTint(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = /R=([\d.]+),G=([\d.]+),B=([\d.]+)(?:,A=([\d.]+))?/.exec(raw);
  if (!m) return undefined;
  const r = Math.round(clamp01(parseFloat(m[1])) * 255);
  const g = Math.round(clamp01(parseFloat(m[2])) * 255);
  const b = Math.round(clamp01(parseFloat(m[3])) * 255);
  return `rgba(${r},${g},${b},0.18)`;
}

function clamp01(v: number): number {
  if (!isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function resolveEdges(
  links: LinkRef[],
  pinIndex: Map<string, Map<string, ParsedPin>>,
  nodes: ParsedNode[],
): ParsedEdge[] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const edges: ParsedEdge[] = [];
  for (const link of links) {
    if (!nodeIds.has(link.fromNode) || !nodeIds.has(link.toNode)) continue;
    const key = `${link.fromNode}|${link.fromPin}->${link.toNode}|${link.toPin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pin = pinIndex.get(link.fromNode)?.get(link.fromPin);
    const type: PinType = pin?.type ?? 'unknown';
    edges.push({
      id: `e_${edges.length}_${link.fromNode}_${link.toNode}`,
      source: link.fromNode,
      sourcePin: link.fromPin,
      target: link.toNode,
      targetPin: link.toPin,
      pinType: type,
    });
  }
  return edges;
}
