import React from 'react';
import type { SelectedEngine } from '../../../../shared/types';
import unrealIcon from '../../assets/engine-unreal.png';
import uefnIcon from '../../assets/engine-uefn.png';
import godotIcon from '../../assets/engine-godot.png';
import unityIcon from '../../assets/engine-unity.png';
import blenderIcon from '../../assets/engine-blender.png';
import robloxIcon from '../../assets/engine-roblox.png';

interface IconProps {
  size?: number;
  className?: string;
}

const ENGINE_IMAGES: Record<NonNullable<SelectedEngine>, string> = {
  unreal: unrealIcon,
  uefn: uefnIcon,
  godot: godotIcon,
  unity: unityIcon,
  blender: blenderIcon,
  roblox: robloxIcon,
};

export function UnrealIcon({ size = 16, className = '' }: IconProps) {
  return <img src={unrealIcon} width={size} height={size} className={className} style={{ objectFit: 'contain' }} alt="Unreal Engine" />;
}

export function GodotIcon({ size = 16, className = '' }: IconProps) {
  return <img src={godotIcon} width={size} height={size} className={className} style={{ objectFit: 'contain' }} alt="Godot" />;
}

export function UnityIcon({ size = 16, className = '' }: IconProps) {
  return <img src={unityIcon} width={size} height={size} className={className} style={{ objectFit: 'contain' }} alt="Unity" />;
}

export function BlenderIcon({ size = 16, className = '' }: IconProps) {
  return <img src={blenderIcon} width={size} height={size} className={className} style={{ objectFit: 'contain' }} alt="Blender" />;
}

export function RobloxIcon({ size = 16, className = '' }: IconProps) {
  return <img src={robloxIcon} width={size} height={size} className={className} style={{ objectFit: 'contain' }} alt="Roblox Studio" />;
}

export function EngineIcon({ engine, size = 16, className = '' }: { engine: SelectedEngine } & IconProps) {
  if (engine && ENGINE_IMAGES[engine]) {
    return <img src={ENGINE_IMAGES[engine]} width={size} height={size} className={className} style={{ objectFit: 'contain' }} alt={ENGINE_NAMES[engine]} />;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <circle cx="8" cy="8" r="7" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
      <text x="8" y="11.5" textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.6)" fontFamily="sans-serif" fontWeight="bold">?</text>
    </svg>
  );
}

export const ENGINE_NAMES: Record<NonNullable<SelectedEngine>, string> = {
  unreal: 'Unreal Engine 5',
  uefn: 'UEFN',
  godot: 'Godot',
  unity: 'Unity',
  blender: 'Blender',
  roblox: 'Roblox Studio',
};
