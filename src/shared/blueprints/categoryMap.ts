import type { NodeCategory } from './types';

export const CATEGORY_COLORS: Record<NodeCategory, string> = {
  Event: '#A63535',
  Function: '#1F6AA8',
  FlowControl: '#4A4A4A',
  Math: '#2E7D4F',
  Variable: '#B58A1F',
  Input: '#C76A2B',
  Comment: '#3A3A3A',
  Unknown: '#555555',
};

const EXACT: Record<string, NodeCategory> = {
  K2Node_Event: 'Event',
  K2Node_CustomEvent: 'Event',
  K2Node_ActorBoundEvent: 'Event',
  K2Node_ComponentBoundEvent: 'Event',
  K2Node_InputAction: 'Input',
  K2Node_InputKey: 'Input',
  K2Node_InputAxisEvent: 'Input',
  K2Node_InputTouch: 'Input',
  K2Node_EnhancedInputAction: 'Input',
  K2Node_IfThenElse: 'FlowControl',
  K2Node_ExecutionSequence: 'FlowControl',
  K2Node_SwitchEnum: 'FlowControl',
  K2Node_SwitchInteger: 'FlowControl',
  K2Node_SwitchString: 'FlowControl',
  K2Node_MultiGate: 'FlowControl',
  K2Node_ForEachLoop: 'FlowControl',
  K2Node_WhileLoop: 'FlowControl',
  K2Node_MakeArray: 'FlowControl',
  K2Node_Select: 'FlowControl',
  K2Node_FlipFlop: 'FlowControl',
  K2Node_Composite: 'FlowControl',
  K2Node_Tunnel: 'FlowControl',
  K2Node_CallFunction: 'Function',
  K2Node_CallDelegate: 'Function',
  K2Node_MacroInstance: 'Function',
  K2Node_SpawnActorFromClass: 'Function',
  K2Node_ConstructObjectFromClass: 'Function',
  K2Node_DynamicCast: 'Function',
  K2Node_Timeline: 'Function',
  K2Node_VariableGet: 'Variable',
  K2Node_VariableSet: 'Variable',
  K2Node_Literal: 'Variable',
  K2Node_Self: 'Variable',
  EdGraphNode_Comment: 'Comment',
};

export function classifyNode(className: string): NodeCategory {
  const short = className.includes('.') ? className.split('.').pop()! : className;
  if (EXACT[short]) return EXACT[short];
  if (short.startsWith('K2Node_Event')) return 'Event';
  if (short.startsWith('K2Node_Switch')) return 'FlowControl';
  if (short.startsWith('K2Node_CallFunction')) return 'Function';
  if (short.startsWith('K2Node_Variable')) return 'Variable';
  if (short.startsWith('K2Node_Input')) return 'Input';
  return 'Unknown';
}

export function headerColorFor(className: string): string {
  return CATEGORY_COLORS[classifyNode(className)];
}

export function prettyNodeTitle(className: string, rawName: string): string {
  const short = className.includes('.') ? className.split('.').pop()! : className;
  const mapped = short.replace(/^K2Node_/, '').replace(/^EdGraphNode_/, '');
  if (mapped === 'Comment') return 'Comment';
  return mapped;
}
