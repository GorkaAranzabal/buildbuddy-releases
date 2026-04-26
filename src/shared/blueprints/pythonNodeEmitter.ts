import type { ParsedGraph, ParsedNode, ParsedPin, RequiredVariable } from './types';
import {
  BLUEPRINT_RESOLUTION,
  COMPILE_AND_OPEN_LINES,
  PIN_TYPE_BUILDER,
  buildVariableCreationLines,
  pythonString,
} from './pythonPreamble';

export interface DirectBuildResult {
  code: string;
  unsupportedClasses: string[];
  nodeCount: number;
}

const SUPPORTED_CLASSES = new Set([
  '/Script/BlueprintGraph.K2Node_Event',
  '/Script/BlueprintGraph.K2Node_CallFunction',
  '/Script/BlueprintGraph.K2Node_VariableGet',
  '/Script/BlueprintGraph.K2Node_VariableSet',
  '/Script/BlueprintGraph.K2Node_InputAction',
  '/Script/BlueprintGraph.K2Node_InputKey',
  '/Script/BlueprintGraph.K2Node_IfThenElse',
  '/Script/BlueprintGraph.K2Node_FlipFlop',
]);

const NODE_HELPERS = `def _find_event_graph(bp):
    try:
        g = unreal.BlueprintEditorLibrary.find_graph(bp, "EventGraph")
        if g is not None:
            return g
    except Exception as e:
        print(f"WARN: find_graph failed: {e}")
    pages = []
    try:
        pages = list(bp.ubergraph_pages)
    except Exception as e:
        print(f"WARN: ubergraph_pages attr: {e}")
    if not pages:
        try:
            pages = list(bp.get_editor_property("UbergraphPages"))
        except Exception as e:
            print(f"WARN: get_editor_property UbergraphPages: {e}")
    if not pages:
        try:
            pages = list(bp.get_editor_property("ubergraph_pages"))
        except Exception:
            pass
    for g in pages:
        try:
            if g.get_name() == "EventGraph":
                return g
        except Exception:
            continue
    if pages:
        return pages[0]
    try:
        attrs = [a for a in dir(bp) if ("graph" in a.lower() or "page" in a.lower()) and not a.startswith("_")]
        print(f"DIAG: graph/page attrs on bp: {attrs}")
    except Exception:
        pass
    return None

def _attach_node(graph, node):
    errors = []
    try:
        graph.add_node(node, False, False)
        return True
    except Exception as e:
        errors.append(f"add_node(3): {e}")
    try:
        graph.add_node(node)
        return True
    except Exception as e:
        errors.append(f"add_node(1): {e}")
    try:
        graph.nodes.append(node)
        if node in list(graph.nodes):
            return True
        errors.append("nodes.append: not present after append")
    except Exception as e:
        errors.append(f"nodes.append: {e}")
    try:
        nodes = list(graph.get_editor_property("Nodes"))
        nodes.append(node)
        graph.set_editor_property("Nodes", nodes)
        return True
    except Exception as e:
        errors.append(f"Nodes prop: {e}")
    try:
        all_attrs = sorted([a for a in dir(graph) if not a.startswith("_")])
        errors.append(f"GRAPH_ATTRS({len(all_attrs)})={all_attrs}")
    except Exception as e:
        errors.append(f"dir(graph) failed: {e}")
    try:
        bel_attrs = sorted([a for a in dir(unreal.BlueprintEditorLibrary) if not a.startswith("_") and ("node" in a.lower() or "paste" in a.lower() or "import" in a.lower() or "add" in a.lower() or "graph" in a.lower())])
        errors.append(f"BEL={bel_attrs}")
    except Exception as e:
        errors.append(f"BEL probe failed: {e}")
    try:
        has_ege = hasattr(unreal, "EdGraphUtilities")
        errors.append(f"has_EdGraphUtilities={has_ege}")
    except Exception:
        pass
    print(f"ERROR: attach node failed | " + " | ".join(errors))
    return False

def _create_node(graph, class_path, x, y):
    try:
        node_class = unreal.load_class(None, class_path)
    except Exception as e:
        print(f"ERROR: load_class {class_path}: {e}")
        return None
    if node_class is None:
        print(f"ERROR: Class not found: {class_path}")
        return None
    try:
        node = unreal.new_object(node_class, outer=graph)
    except Exception as e:
        print(f"ERROR: new_object {class_path}: {e}")
        return None
    try:
        node.set_editor_property("NodePosX", int(x))
        node.set_editor_property("NodePosY", int(y))
    except Exception:
        pass
    if not _attach_node(graph, node):
        return None
    return node

def _reconstruct(node):
    try:
        node.reconstruct_node()
    except Exception as e:
        print(f"WARN: reconstruct_node failed: {e}")

def _load_parent_class(parent_path):
    if not parent_path:
        return None
    try:
        return unreal.load_class(None, parent_path)
    except Exception as e:
        print(f"WARN: load_class {parent_path}: {e}")
        return None

def _set_member_reference(node, prop_name, member_name, parent_path=None, self_context=False):
    try:
        ref = node.get_editor_property(prop_name)
    except Exception as e:
        print(f"WARN: get {prop_name} failed: {e}")
        ref = None
    try:
        if ref is None:
            raise RuntimeError("no existing reference")
        ref.set_editor_property("MemberName", member_name)
        if self_context:
            try:
                ref.set_editor_property("bSelfContext", True)
            except Exception:
                pass
        elif parent_path:
            parent_cls = _load_parent_class(parent_path)
            if parent_cls is not None:
                try:
                    ref.set_editor_property("MemberParent", parent_cls)
                except Exception as e:
                    print(f"WARN: set MemberParent on {prop_name}: {e}")
        try:
            node.set_editor_property(prop_name, ref)
        except Exception:
            pass
    except Exception as e:
        print(f"WARN: set reference {prop_name} failed: {e}")

def _setup_callfunction(node, parent_path, member_name):
    if hasattr(node, "set_from_function"):
        try:
            uf = None
            if parent_path and member_name:
                try:
                    uf = unreal.load_object(None, parent_path + ":" + member_name)
                except Exception:
                    uf = None
            if uf is not None:
                node.set_from_function(uf)
                _reconstruct(node)
                return
        except Exception as e:
            print(f"WARN: set_from_function: {e}")
    _set_member_reference(node, "function_reference", member_name, parent_path=parent_path)
    _reconstruct(node)

def _setup_event(node, parent_path, member_name):
    _set_member_reference(node, "event_reference", member_name, parent_path=parent_path)
    try:
        node.set_editor_property("bOverrideFunction", True)
    except Exception:
        pass
    _reconstruct(node)

def _setup_variable(node, member_name):
    _set_member_reference(node, "variable_reference", member_name, self_context=True)
    _reconstruct(node)

def _setup_input_action(node, action_name):
    try:
        node.set_editor_property("input_action_name", action_name)
    except Exception as e:
        print(f"WARN: set input_action_name: {e}")
    _reconstruct(node)

def _setup_input_key(node, key_name):
    set_ok = False
    try:
        node.set_editor_property("input_key", unreal.Key(key_name))
        set_ok = True
    except Exception:
        pass
    if not set_ok:
        try:
            k = node.get_editor_property("input_key")
            k.set_editor_property("KeyName", key_name)
            node.set_editor_property("input_key", k)
            set_ok = True
        except Exception as e:
            print(f"WARN: set input_key {key_name}: {e}")
    _reconstruct(node)

def _link_pins(src_node, src_pin_name, dst_node, dst_pin_name):
    try:
        src_pin = src_node.find_pin(src_pin_name)
        dst_pin = dst_node.find_pin(dst_pin_name)
    except Exception as e:
        print(f"WARN: find_pin failed: {e}")
        return
    if src_pin is None or dst_pin is None:
        print(f"WARN: missing pin {src_pin_name} -> {dst_pin_name}")
        return
    try:
        src_pin.make_link_to(dst_pin)
    except Exception as e:
        print(f"WARN: make_link_to {src_pin_name} -> {dst_pin_name}: {e}")

def _set_pin_default(node, pin_name, default_value):
    try:
        pin = node.find_pin(pin_name)
        if pin is None:
            return
        pin.default_value = default_value
    except Exception as e:
        print(f"WARN: set default on {pin_name}: {e}")
`;

function extractMember(raw: string | undefined, key: string): string | undefined {
  if (!raw) return undefined;
  const re = new RegExp(`${key}="?([^",)]+)"?`);
  const m = re.exec(raw);
  return m ? m[1] : undefined;
}

function extractParentPath(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = /MemberParent=Class['"]([^'"]+)['"]/.exec(raw);
  return m ? m[1] : undefined;
}

function stripQuotes(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  return s.replace(/^"|"$/g, '');
}

function nodeVar(nodeId: string): string {
  return `n_${nodeId.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function emitNode(node: ParsedNode): string[] {
  const lines: string[] = [];
  const v = nodeVar(node.id);
  const classPath = node.className;
  lines.push(
    `    ${v} = _create_node(graph, ${pythonString(classPath)}, ${Math.round(node.x)}, ${Math.round(node.y)})`,
  );
  lines.push(`    if ${v} is not None:`);
  lines.push(`        node_refs[${pythonString(node.id)}] = ${v}`);

  const props = node.rawProps;

  if (classPath.endsWith('K2Node_CallFunction')) {
    const fn = props.FunctionReference;
    const member = extractMember(fn, 'MemberName');
    const parent = extractParentPath(fn);
    if (member) {
      lines.push(
        `        _setup_callfunction(${v}, ${parent ? pythonString(parent) : 'None'}, ${pythonString(member)})`,
      );
    }
  } else if (classPath.endsWith('K2Node_Event')) {
    const ev = props.EventReference;
    const member = extractMember(ev, 'MemberName');
    const parent = extractParentPath(ev);
    if (member) {
      lines.push(
        `        _setup_event(${v}, ${parent ? pythonString(parent) : 'None'}, ${pythonString(member)})`,
      );
    }
  } else if (
    classPath.endsWith('K2Node_VariableGet') ||
    classPath.endsWith('K2Node_VariableSet')
  ) {
    const vr = props.VariableReference;
    const member = extractMember(vr, 'MemberName');
    if (member) {
      lines.push(`        _setup_variable(${v}, ${pythonString(member)})`);
    }
  } else if (classPath.endsWith('K2Node_InputAction')) {
    const actionName = stripQuotes(props.InputActionName);
    if (actionName) {
      lines.push(`        _setup_input_action(${v}, ${pythonString(actionName)})`);
    }
  } else if (classPath.endsWith('K2Node_InputKey')) {
    const keyName = stripQuotes(props.InputKey);
    if (keyName) {
      lines.push(`        _setup_input_key(${v}, ${pythonString(keyName)})`);
    }
  } else {
    lines.push(`        _reconstruct(${v})`);
  }

  return lines;
}

function emitDefaults(graph: ParsedGraph): string[] {
  const lines: string[] = [];
  for (const node of graph.nodes) {
    const v = nodeVar(node.id);
    for (const pin of node.inputs) {
      if (pin.isExec) continue;
      if (pin.defaultValue === undefined || pin.defaultValue === '') continue;
      lines.push(
        `    if ${pythonString(node.id)} in node_refs: _set_pin_default(node_refs[${pythonString(node.id)}], ${pythonString(pin.name)}, ${pythonString(pin.defaultValue)})`,
      );
    }
  }
  return lines;
}

function emitLinks(graph: ParsedGraph): string[] {
  const lines: string[] = [];
  const pinNameById = new Map<string, Map<string, ParsedPin>>();
  for (const n of graph.nodes) {
    const m = new Map<string, ParsedPin>();
    for (const p of [...n.inputs, ...n.outputs]) m.set(p.id, p);
    pinNameById.set(n.id, m);
  }
  const seen = new Set<string>();
  for (const e of graph.edges) {
    const key = `${e.source}|${e.sourcePin}->${e.target}|${e.targetPin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const srcPin = pinNameById.get(e.source)?.get(e.sourcePin);
    const dstPin = pinNameById.get(e.target)?.get(e.targetPin);
    if (!srcPin || !dstPin) continue;
    lines.push(
      `    if ${pythonString(e.source)} in node_refs and ${pythonString(e.target)} in node_refs:`,
    );
    lines.push(
      `        _link_pins(node_refs[${pythonString(e.source)}], ${pythonString(srcPin.name)}, node_refs[${pythonString(e.target)}], ${pythonString(dstPin.name)})`,
    );
  }
  return lines;
}

export function generateDirectBuildPython(
  graph: ParsedGraph,
  requiredVars: RequiredVariable[],
): DirectBuildResult {
  const unsupportedClasses: string[] = [];
  for (const n of graph.nodes) {
    if (!SUPPORTED_CLASSES.has(n.className)) {
      if (!unsupportedClasses.includes(n.className)) unsupportedClasses.push(n.className);
    }
  }

  const lines: string[] = [
    'import unreal',
    '',
    PIN_TYPE_BUILDER,
    NODE_HELPERS,
    BLUEPRINT_RESOLUTION,
    '',
    ...buildVariableCreationLines(requiredVars),
    '    graph = _find_event_graph(bp)',
    '    if graph is None:',
    '        print("ERROR: Blueprint has no event graph.")',
    '    else:',
    '        node_refs = {}',
  ];

  const nodeLines = graph.nodes.flatMap(emitNode);
  for (const l of nodeLines) lines.push('    ' + l);

  const linkLines = emitLinks(graph);
  for (const l of linkLines) lines.push('    ' + l);

  const defaultLines = emitDefaults(graph);
  for (const l of defaultLines) lines.push('    ' + l);

  lines.push(...COMPILE_AND_OPEN_LINES);
  lines.push('    print("Done. Nodes built directly in the event graph.")');

  return {
    code: lines.join('\n'),
    unsupportedClasses,
    nodeCount: graph.nodes.length,
  };
}
