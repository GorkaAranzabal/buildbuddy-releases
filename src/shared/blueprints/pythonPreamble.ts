import type { RequiredVariable, RequiredVariableType } from './types';

interface PinTypeSpec {
  category: string;
  subCategory?: string;
}

export const PIN_TYPE_BY_VAR: Record<RequiredVariableType, PinTypeSpec> = {
  float: { category: 'real', subCategory: 'double' },
  int: { category: 'int' },
  bool: { category: 'bool' },
  string: { category: 'string' },
  vector: { category: 'struct', subCategory: 'Vector' },
};

export function pythonString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export const PIN_TYPE_BUILDER = `def _build_pin_type(category, sub_category=""):
    errors = []
    try:
        if sub_category:
            return unreal.EdGraphPinType(pin_category=category, pin_sub_category=sub_category)
        return unreal.EdGraphPinType(pin_category=category)
    except Exception as e:
        errors.append("kwargs: " + str(e))
    try:
        t = unreal.EdGraphPinType()
        t.pin_category = category
        if sub_category:
            t.pin_sub_category = sub_category
        return t
    except Exception as e:
        errors.append("attr: " + str(e))
    try:
        t = unreal.EdGraphPinType()
        t.set_editor_property("PinCategory", category)
        if sub_category:
            t.set_editor_property("PinSubCategory", sub_category)
        return t
    except Exception as e:
        errors.append("set_editor_property: " + str(e))
    try:
        t = unreal.EdGraphPinType()
        text = '(PinCategory="' + category + '"'
        if sub_category:
            text += ',PinSubCategory="' + sub_category + '"'
        text += ")"
        if hasattr(t, "import_text") and t.import_text(text):
            return t
        errors.append("import_text: no success")
    except Exception as e:
        errors.append("import_text: " + str(e))
    try:
        t = unreal.EdGraphPinType()
        attrs = sorted([a for a in dir(t) if not a.startswith("_")])
        errors.append("available attrs: " + ", ".join(attrs))
    except Exception:
        pass
    raise RuntimeError("ERROR: Cannot build EdGraphPinType for " + category + " | " + " | ".join(errors))
`;

export const BLUEPRINT_RESOLUTION = [
  'subsystem = unreal.get_editor_subsystem(unreal.AssetEditorSubsystem)',
  'try:',
  '    open_assets = list(subsystem.get_all_edited_assets())',
  'except Exception:',
  '    open_assets = []',
  'open_bps = [a for a in open_assets if isinstance(a, unreal.Blueprint)]',
  'selected = unreal.EditorUtilityLibrary.get_selected_assets()',
  'selected_bps = [a for a in selected if isinstance(a, unreal.Blueprint)]',
  '',
  'bp = None',
  'if len(selected_bps) == 1:',
  '    bp = selected_bps[0]',
  'elif len(selected_bps) > 1:',
  '    print(f"ERROR: {len(selected_bps)} blueprints selected in the Content Browser. Select only ONE, or deselect all and keep one blueprint open.")',
  'elif len(open_bps) == 1:',
  '    bp = open_bps[0]',
  'elif len(open_bps) > 1:',
  '    names = ", ".join(b.get_name() for b in open_bps)',
  '    print(f"ERROR: {len(open_bps)} blueprints open ({names}). Close the extras, or click ONE in the Content Browser to pick.")',
  'else:',
  '    print("ERROR: No blueprint open or selected. Either open your target blueprint, or click it ONCE in the Content Browser.")',
  '',
  'if bp is not None:',
  '    print(f"Target: {bp.get_path_name()}")',
].join('\n');

export function buildVariableCreationLines(vars: RequiredVariable[], indent = '    '): string[] {
  if (vars.length === 0) return [];
  const lines: string[] = [];
  vars.forEach((v, i) => {
    const pin = PIN_TYPE_BY_VAR[v.type];
    const typeVar = `t${i}`;
    const subArg = pin.subCategory ? `, ${pythonString(pin.subCategory)}` : '';
    lines.push(`${indent}${typeVar} = _build_pin_type(${pythonString(pin.category)}${subArg})`);
    const nameArg = pythonString(v.name);
    if (v.default_value !== undefined) {
      const defArg = pythonString(v.default_value);
      lines.push(`${indent}try:`);
      lines.push(
        `${indent}    ok = unreal.BlueprintEditorLibrary.add_member_variable(bp, ${nameArg}, ${typeVar}, ${defArg})`,
      );
      lines.push(`${indent}except TypeError:`);
      lines.push(
        `${indent}    ok = unreal.BlueprintEditorLibrary.add_member_variable(bp, ${nameArg}, ${typeVar})`,
      );
    } else {
      lines.push(
        `${indent}ok = unreal.BlueprintEditorLibrary.add_member_variable(bp, ${nameArg}, ${typeVar})`,
      );
    }
    lines.push(`${indent}print("\\u2713 Added" if ok else "\\u2022 Already exists", ${nameArg})`);
    lines.push('');
  });
  return lines;
}

export const COMPILE_AND_OPEN_LINES = [
  '    unreal.BlueprintEditorLibrary.compile_blueprint(bp)',
  '    try:',
  '        unreal.get_editor_subsystem(unreal.AssetEditorSubsystem).open_editor_for_assets([bp])',
  '    except Exception as e:',
  '        print("Could not open blueprint editor:", e)',
];
