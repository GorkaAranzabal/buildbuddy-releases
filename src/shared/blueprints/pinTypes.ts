import type { PinType } from './types';

export const PIN_COLORS: Record<PinType, string> = {
  exec: '#FFFFFF',
  bool: '#E53935',
  int: '#26C6DA',
  float: '#66BB6A',
  string: '#EC407A',
  object: '#42A5F5',
  struct: '#FFCA28',
  unknown: '#9E9E9E',
};

export function classifyPin(pinCategory: string | undefined): PinType {
  if (!pinCategory) return 'unknown';
  const c = pinCategory.toLowerCase();
  if (c === 'exec') return 'exec';
  if (c === 'bool' || c === 'boolean') return 'bool';
  if (c === 'int' || c === 'int64' || c === 'byte') return 'int';
  if (c === 'float' || c === 'double' || c === 'real') return 'float';
  if (c === 'string' || c === 'name' || c === 'text') return 'string';
  if (c === 'object' || c === 'class' || c === 'interface' || c === 'softobject' || c === 'softclass') return 'object';
  if (c === 'struct') return 'struct';
  return 'unknown';
}

export function pinColor(type: PinType): string {
  return PIN_COLORS[type];
}
