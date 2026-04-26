export type NodeCategory =
  | 'Event'
  | 'Function'
  | 'FlowControl'
  | 'Math'
  | 'Variable'
  | 'Input'
  | 'Comment'
  | 'Unknown';

export type PinType =
  | 'exec'
  | 'bool'
  | 'int'
  | 'float'
  | 'string'
  | 'object'
  | 'struct'
  | 'unknown';

export type PinDirection = 'input' | 'output';

export interface ParsedPin {
  id: string;
  name: string;
  type: PinType;
  direction: PinDirection;
  isExec: boolean;
  subCategory?: string;
  subCategoryObject?: string;
  defaultValue?: string;
  defaultObject?: string;
}

export interface ParsedNode {
  id: string;
  title: string;
  className: string;
  category: NodeCategory;
  headerColor: string;
  x: number;
  y: number;
  inputs: ParsedPin[];
  outputs: ParsedPin[];
  collapsed?: boolean;
  rawProps: Record<string, string>;
}

export interface ParsedEdge {
  id: string;
  source: string;
  sourcePin: string;
  target: string;
  targetPin: string;
  pinType: PinType;
}

export interface ParsedComment {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  tint: string;
}

export interface ParsedGraph {
  nodes: ParsedNode[];
  edges: ParsedEdge[];
  comments: ParsedComment[];
}

export type ParseResult =
  | { ok: true; graph: ParsedGraph }
  | { ok: false; reason: string };

export type RequiredVariableType = 'float' | 'int' | 'bool' | 'string' | 'vector';

export interface RequiredVariable {
  name: string;
  type: RequiredVariableType;
  default_value?: string;
}

export type ParameterKind = 'key_name' | 'string' | 'number';

export interface SnippetParameter {
  name: string;
  kind: ParameterKind;
  default: string;
  description?: string;
}

export interface BlueprintSnippet {
  id: string;
  title: string;
  description: string;
  category: NodeCategory | string;
  tags: string[];
  target_blueprint: string;
  paste_instructions: string;
  t3d: string;
  is_intro: boolean;
  required_variables?: RequiredVariable[];
  parameters?: SnippetParameter[];
}
