import type { RequiredVariable } from './types';
import {
  BLUEPRINT_RESOLUTION,
  COMPILE_AND_OPEN_LINES,
  PIN_TYPE_BUILDER,
  buildVariableCreationLines,
} from './pythonPreamble';

export function generateVariablePython(vars: RequiredVariable[]): string {
  if (vars.length === 0) return '';

  const lines: string[] = [
    'import unreal',
    '',
    PIN_TYPE_BUILDER,
    BLUEPRINT_RESOLUTION,
    '',
    ...buildVariableCreationLines(vars),
    ...COMPILE_AND_OPEN_LINES,
    '    print("Done. Press Ctrl+V in the event graph to paste the T3D.")',
  ];

  return lines.join('\n');
}
