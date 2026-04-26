import type { BlueprintSnippet, RequiredVariable } from './types';

// Compose multiple library snippets into a single T3D paste.
//
// Snippets are placed side-by-side with no cross-snippet exec-pin linking —
// each remains a self-contained subgraph. Renumbering is regex-level on the
// raw T3D string. For each snippet index i:
//  - K2Node_<Class>_<N> is offset to K2Node_<Class>_<N + i*NODE_OFFSET>
//  - NodePosX is offset by i * X_SPACING
//  - Every 32-hex identifier (NodeGuid, PinId, LinkedTo pin refs) is replaced
//    with a freshly generated 32-hex identifier, preserving intra-snippet
//    LinkedTo references via a per-snippet map.

const NODE_OFFSET = 100;
const X_SPACING = 900;

export function rand32Hex(): string {
  let s = '';
  for (let i = 0; i < 32; i++) {
    s += Math.floor(Math.random() * 16).toString(16);
  }
  return s;
}

export function applySnippetParams(
  snippet: BlueprintSnippet,
  overrides?: Record<string, string>,
): string {
  const params = snippet.parameters;
  if (!params || params.length === 0) return snippet.t3d;
  let out = snippet.t3d;
  for (const p of params) {
    const value = overrides?.[p.name] ?? p.default;
    out = out.split(`{{${p.name}}}`).join(value);
  }
  return out;
}

function renumberSnippet(t3d: string, snippetIndex: number): string {
  const idMap = new Map<string, string>();
  let out = t3d.replace(/\b[0-9a-fA-F]{32}\b/g, (match) => {
    const key = match.toLowerCase();
    let replacement = idMap.get(key);
    if (!replacement) {
      replacement = rand32Hex();
      idMap.set(key, replacement);
    }
    return replacement;
  });

  if (snippetIndex > 0) {
    const offset = snippetIndex * NODE_OFFSET;
    out = out.replace(/\b(K2Node_[A-Za-z0-9]+)_(\d+)\b/g, (_, cls: string, n: string) => {
      return `${cls}_${parseInt(n, 10) + offset}`;
    });
    const xShift = snippetIndex * X_SPACING;
    out = out.replace(/NodePosX=(-?\d+)/g, (_, x: string) => {
      return `NodePosX=${parseInt(x, 10) + xShift}`;
    });
  }

  return out;
}

export interface VariableConflict {
  name: string;
  typeA: string;
  typeB: string;
}

export interface ComposeResult {
  t3d: string;
  requiredVars: RequiredVariable[];
  targetBlueprint: string;
  conflicts: VariableConflict[];
  unknownIds: string[];
  usedSnippets: BlueprintSnippet[];
}

export function composeSnippets(
  snippetIds: string[],
  allSnippets: BlueprintSnippet[],
  paramsBySnippet?: Record<string, Record<string, string>>,
): ComposeResult {
  const byId = new Map(allSnippets.map((s) => [s.id, s]));
  const used: BlueprintSnippet[] = [];
  const unknownIds: string[] = [];

  for (const id of snippetIds) {
    const snippet = byId.get(id);
    if (snippet) used.push(snippet);
    else unknownIds.push(id);
  }

  const varsByName = new Map<string, RequiredVariable>();
  const conflicts: VariableConflict[] = [];
  for (const snippet of used) {
    for (const v of snippet.required_variables ?? []) {
      const existing = varsByName.get(v.name);
      if (!existing) {
        varsByName.set(v.name, v);
      } else if (existing.type !== v.type) {
        conflicts.push({ name: v.name, typeA: existing.type, typeB: v.type });
      }
    }
  }

  const targetCounts = new Map<string, number>();
  for (const snippet of used) {
    targetCounts.set(snippet.target_blueprint, (targetCounts.get(snippet.target_blueprint) ?? 0) + 1);
  }
  let targetBlueprint = used[0]?.target_blueprint ?? '';
  let bestCount = 0;
  for (const [name, count] of targetCounts) {
    if (count > bestCount) {
      targetBlueprint = name;
      bestCount = count;
    }
  }

  const t3d = used
    .map((snippet, i) => {
      const resolved = applySnippetParams(snippet, paramsBySnippet?.[snippet.id]);
      return renumberSnippet(resolved, i).trimEnd();
    })
    .join('\n');

  return {
    t3d,
    requiredVars: Array.from(varsByName.values()),
    targetBlueprint,
    conflicts,
    unknownIds,
    usedSnippets: used,
  };
}
