import React from 'react';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export function IconButton({
  children,
  variant = 'default',
  size = 'md',
  className = '',
  ...props
}: IconButtonProps) {
  const baseStyles = 'rounded transition-colors flex items-center justify-center';

  const variantStyles = {
    default: 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50',
    danger: 'text-zinc-400 hover:text-red-400 hover:bg-red-500/20',
  };

  const sizeStyles = {
    sm: 'p-1',
    md: 'p-1.5',
    lg: 'p-2',
  };

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
