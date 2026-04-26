import { rand32Hex } from './composer';
import type { RequiredVariable, RequiredVariableType } from './types';

// Tier 3 freeform Blueprint compiler.
//
// v1 limits (intentional):
//  - Linear exec chain only. No IfThenElse, FlipFlop, or math nodes.
//  - Functions must come from WHITELIST. The LLM cannot name others.
//  - set_variable literals are baked on the pin as DefaultValue — variable
//    type is inferred from the literal and added to requiredVars.
//  - No target-pin wiring for component functions; the user wires those
//    themselves (matches sprint-on-shift).

export type TriggerIntent =
  | { kind: 'input_key'; key: string; phase?: 'Pressed' | 'Released' }
  | { kind: 'input_action'; action: string; phase?: 'Pressed' | 'Released' }
  | {
      kind: 'event';
      event:
        | 'ReceiveBeginPlay'
        | 'ReceiveTick'
        | 'ReceiveActorBeginOverlap'
        | 'ReceiveAnyDamage';
    };

export type ActionIntent =
  | { kind: 'print'; message: string }
  | { kind: 'call_function'; function_ref: string }
  | { kind: 'set_variable'; name: string; literal: string };

export interface BlueprintIntent {
  target_blueprint: string;
  variables?: RequiredVariable[];
  trigger: TriggerIntent;
  actions: ActionIntent[];
}

export type CompileResult =
  | { ok: true; t3d: string; requiredVars: RequiredVariable[]; targetBlueprint: string }
  | { ok: false; error: string };

interface FunctionSpec {
  memberName: string;
  memberParent: string;
  extraPins?: Array<{ name: string; pinType: string; defaultValue: string }>;
}

const FUNCTION_WHITELIST: Record<string, FunctionSpec> = {
  'GameplayStatics.SetGamePaused': {
    memberName: 'SetGamePaused',
    memberParent: "Class'/Script/Engine.GameplayStatics'",
    extraPins: [{ name: 'bPaused', pinType: 'PinType.PinCategory="bool"', defaultValue: 'true' }],
  },
  'KismetSystemLibrary.PrintString': {
    memberName: 'PrintString',
    memberParent: "Class'/Script/Engine.KismetSystemLibrary'",
    extraPins: [{ name: 'InString', pinType: 'PinType.PinCategory="string"', defaultValue: 'Hello' }],
  },
  'KismetSystemLibrary.QuitGame': {
    memberName: 'QuitGame',
    memberParent: "Class'/Script/Engine.KismetSystemLibrary'",
  },
  'Character.Jump': {
    memberName: 'Jump',
    memberParent: "Class'/Script/Engine.Character'",
  },
  'Character.StopJumping': {
    memberName: 'StopJumping',
    memberParent: "Class'/Script/Engine.Character'",
  },
  'Character.Crouch': {
    memberName: 'Crouch',
    memberParent: "Class'/Script/Engine.Character'",
  },
  'Character.UnCrouch': {
    memberName: 'UnCrouch',
    memberParent: "Class'/Script/Engine.Character'",
  },
  'Actor.K2_DestroyActor': {
    memberName: 'K2_DestroyActor',
    memberParent: "Class'/Script/Engine.Actor'",
  },
  'PlayerController.SetShowMouseCursor': {
    memberName: 'SetShowMouseCursor',
    memberParent: "Class'/Script/Engine.PlayerController'",
    extraPins: [{ name: 'bShow', pinType: 'PinType.PinCategory="bool"', defaultValue: 'true' }],
  },
};

const X_STEP = 260;
const TRIGGER_X = -320;

interface BuiltNode {
  name: string;
  execInPinId?: string;
  execOutPinId?: string;
  body: string;
}

function inferVariableType(literal: string): RequiredVariableType {
  if (literal === 'true' || literal === 'false') return 'bool';
  if (/^-?\d+$/.test(literal)) return 'int';
  if (/^-?\d*\.\d+$/.test(literal)) return 'float';
  return 'string';
}

function variablePinType(t: RequiredVariableType): string {
  switch (t) {
    case 'bool':
      return 'PinType.PinCategory="bool"';
    case 'int':
      return 'PinType.PinCategory="int"';
    case 'float':
      return 'PinType.PinCategory="real",PinType.PinSubCategory="double"';
    case 'string':
      return 'PinType.PinCategory="string"';
    case 'vector':
      return 'PinType.PinCategory="struct",PinType.PinSubCategoryObject=ScriptStruct\'/Script/CoreUObject.Vector\'';
  }
}

function buildInputKey(
  nameIndex: number,
  key: string,
  phase: 'Pressed' | 'Released',
): BuiltNode {
  const name = `K2Node_InputKey_${nameIndex}`;
  const guid = rand32Hex();
  const pressedId = rand32Hex();
  const releasedId = rand32Hex();
  const execOutPinId = phase === 'Pressed' ? pressedId : releasedId;
  const body =
    `Begin Object Class=/Script/BlueprintGraph.K2Node_InputKey Name="${name}"\n` +
    `   InputKey=${key}\n` +
    `   NodePosX=${TRIGGER_X}\n` +
    `   NodePosY=64\n` +
    `   NodeGuid=${guid}\n` +
    `   CustomProperties Pin (PinId=${pressedId},PinName="Pressed",Direction="EGPD_Output",PinType.PinCategory="exec"{{linkedto:${pressedId}}})\n` +
    `   CustomProperties Pin (PinId=${releasedId},PinName="Released",Direction="EGPD_Output",PinType.PinCategory="exec"{{linkedto:${releasedId}}})\n` +
    `End Object`;
  return { name, execOutPinId, body };
}

function buildInputAction(
  nameIndex: number,
  action: string,
  phase: 'Pressed' | 'Released',
): BuiltNode {
  const name = `K2Node_InputAction_${nameIndex}`;
  const guid = rand32Hex();
  const pressedId = rand32Hex();
  const releasedId = rand32Hex();
  const keyId = rand32Hex();
  const execOutPinId = phase === 'Pressed' ? pressedId : releasedId;
  const body =
    `Begin Object Class=/Script/BlueprintGraph.K2Node_InputAction Name="${name}"\n` +
    `   InputActionName="${action}"\n` +
    `   bConsumeInput=True\n` +
    `   NodePosX=${TRIGGER_X}\n` +
    `   NodePosY=64\n` +
    `   NodeGuid=${guid}\n` +
    `   CustomProperties Pin (PinId=${pressedId},PinName="Pressed",Direction="EGPD_Output",PinType.PinCategory="exec"{{linkedto:${pressedId}}})\n` +
    `   CustomProperties Pin (PinId=${releasedId},PinName="Released",Direction="EGPD_Output",PinType.PinCategory="exec"{{linkedto:${releasedId}}})\n` +
    `   CustomProperties Pin (PinId=${keyId},PinName="Key",Direction="EGPD_Output",PinType.PinCategory="struct",PinType.PinSubCategoryObject=ScriptStruct'/Script/InputCore.Key')\n` +
    `End Object`;
  return { name, execOutPinId, body };
}

function buildEvent(nameIndex: number, eventName: string): BuiltNode {
  const name = `K2Node_Event_${nameIndex}`;
  const guid = rand32Hex();
  const thenId = rand32Hex();
  const body =
    `Begin Object Class=/Script/BlueprintGraph.K2Node_Event Name="${name}"\n` +
    `   EventReference=(MemberParent=Class'/Script/Engine.Actor',MemberName="${eventName}")\n` +
    `   bOverrideFunction=True\n` +
    `   NodePosX=${TRIGGER_X}\n` +
    `   NodePosY=0\n` +
    `   NodeGuid=${guid}\n` +
    `   CustomProperties Pin (PinId=${thenId},PinName="then",Direction="EGPD_Output",PinType.PinCategory="exec"{{linkedto:${thenId}}})\n` +
    `End Object`;
  return { name, execOutPinId: thenId, body };
}

function buildCallFunction(
  nameIndex: number,
  x: number,
  spec: FunctionSpec,
  extraPinOverrides: Record<string, string> = {},
): BuiltNode {
  const name = `K2Node_CallFunction_${nameIndex}`;
  const guid = rand32Hex();
  const execInId = rand32Hex();
  const thenId = rand32Hex();
  const extras = (spec.extraPins ?? [])
    .map((pin) => {
      const pid = rand32Hex();
      const value = extraPinOverrides[pin.name] ?? pin.defaultValue;
      return `   CustomProperties Pin (PinId=${pid},PinName="${pin.name}",Direction="EGPD_Input",${pin.pinType},DefaultValue="${value}")`;
    })
    .join('\n');
  const body =
    `Begin Object Class=/Script/BlueprintGraph.K2Node_CallFunction Name="${name}"\n` +
    `   FunctionReference=(MemberName="${spec.memberName}",MemberParent=${spec.memberParent})\n` +
    `   NodePosX=${x}\n` +
    `   NodePosY=0\n` +
    `   NodeGuid=${guid}\n` +
    `   CustomProperties Pin (PinId=${execInId},PinName="execute",Direction="EGPD_Input",PinType.PinCategory="exec"{{linkedto:${execInId}}})\n` +
    `   CustomProperties Pin (PinId=${thenId},PinName="then",Direction="EGPD_Output",PinType.PinCategory="exec"{{linkedto:${thenId}}})` +
    (extras ? `\n${extras}` : '') +
    `\nEnd Object`;
  return { name, execInPinId: execInId, execOutPinId: thenId, body };
}

function buildVariableSet(
  nameIndex: number,
  x: number,
  varName: string,
  varType: RequiredVariableType,
  literal: string,
): BuiltNode {
  const name = `K2Node_VariableSet_${nameIndex}`;
  const guid = rand32Hex();
  const execInId = rand32Hex();
  const valueInId = rand32Hex();
  const thenId = rand32Hex();
  const pinType = variablePinType(varType);
  const body =
    `Begin Object Class=/Script/BlueprintGraph.K2Node_VariableSet Name="${name}"\n` +
    `   VariableReference=(MemberName="${varName}",bSelfContext=True)\n` +
    `   NodePosX=${x}\n` +
    `   NodePosY=0\n` +
    `   NodeGuid=${guid}\n` +
    `   CustomProperties Pin (PinId=${execInId},PinName="execute",Direction="EGPD_Input",PinType.PinCategory="exec"{{linkedto:${execInId}}})\n` +
    `   CustomProperties Pin (PinId=${valueInId},PinName="${varName}",Direction="EGPD_Input",${pinType},DefaultValue="${literal}")\n` +
    `   CustomProperties Pin (PinId=${thenId},PinName="then",Direction="EGPD_Output",PinType.PinCategory="exec"{{linkedto:${thenId}}})\n` +
    `End Object`;
  return { name, execInPinId: execInId, execOutPinId: thenId, body };
}

function applyWiring(
  node: BuiltNode,
  wiring: Map<string, { targetName: string; targetPinId: string }>,
): string {
  return node.body.replace(/\{\{linkedto:([0-9a-f]{32})\}\}/g, (_, pinId: string) => {
    const edge = wiring.get(pinId);
    if (!edge) return '';
    return `,LinkedTo=(${edge.targetName} ${edge.targetPinId},)`;
  });
}

export function compileIntent(intent: BlueprintIntent): CompileResult {
  if (!intent || !intent.trigger || !Array.isArray(intent.actions)) {
    return { ok: false, error: 'Intent must include trigger and actions.' };
  }
  if (intent.actions.length === 0) {
    return { ok: false, error: 'Intent must include at least one action.' };
  }

  const requiredVars: RequiredVariable[] = [...(intent.variables ?? [])];
  const nodes: BuiltNode[] = [];

  let triggerNode: BuiltNode;
  if (intent.trigger.kind === 'input_key') {
    if (!intent.trigger.key) return { ok: false, error: 'input_key trigger requires a key.' };
    triggerNode = buildInputKey(0, intent.trigger.key, intent.trigger.phase ?? 'Pressed');
  } else if (intent.trigger.kind === 'input_action') {
    if (!intent.trigger.action) return { ok: false, error: 'input_action trigger requires an action name.' };
    triggerNode = buildInputAction(0, intent.trigger.action, intent.trigger.phase ?? 'Pressed');
  } else if (intent.trigger.kind === 'event') {
    triggerNode = buildEvent(0, intent.trigger.event);
  } else {
    return { ok: false, error: `Unknown trigger kind: ${(intent.trigger as { kind: string }).kind}` };
  }
  nodes.push(triggerNode);

  let callFnIndex = 0;
  let varSetIndex = 0;
  for (let i = 0; i < intent.actions.length; i++) {
    const action = intent.actions[i];
    const x = i * X_STEP;
    if (action.kind === 'print') {
      const spec = FUNCTION_WHITELIST['KismetSystemLibrary.PrintString'];
      nodes.push(
        buildCallFunction(callFnIndex++, x, spec, { InString: action.message }),
      );
    } else if (action.kind === 'call_function') {
      const spec = FUNCTION_WHITELIST[action.function_ref];
      if (!spec) {
        return {
          ok: false,
          error: `Function "${action.function_ref}" is not on the whitelist. Use a library snippet via compose_blueprint, or pick a whitelisted function.`,
        };
      }
      nodes.push(buildCallFunction(callFnIndex++, x, spec));
    } else if (action.kind === 'set_variable') {
      const existing = requiredVars.find((v) => v.name === action.name);
      const varType: RequiredVariableType = existing?.type ?? inferVariableType(action.literal);
      if (!existing) {
        requiredVars.push({ name: action.name, type: varType, default_value: action.literal });
      }
      nodes.push(buildVariableSet(varSetIndex++, x, action.name, varType, action.literal));
    } else {
      return { ok: false, error: `Unknown action kind: ${(action as { kind: string }).kind}` };
    }
  }

  const wiring = new Map<string, { targetName: string; targetPinId: string }>();
  for (let i = 0; i < nodes.length - 1; i++) {
    const current = nodes[i];
    const next = nodes[i + 1];
    if (!current.execOutPinId || !next.execInPinId) continue;
    wiring.set(current.execOutPinId, { targetName: next.name, targetPinId: next.execInPinId });
    wiring.set(next.execInPinId, { targetName: current.name, targetPinId: current.execOutPinId });
  }

  const t3d = nodes.map((n) => applyWiring(n, wiring)).join('\n');
  return {
    ok: true,
    t3d,
    requiredVars,
    targetBlueprint: intent.target_blueprint || 'Actor',
  };
}

export function whitelistedFunctionIds(): string[] {
  return Object.keys(FUNCTION_WHITELIST);
}
