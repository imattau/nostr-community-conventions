import React from 'react';

const VARIANTS = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-600/20',
  secondary: 'bg-slate-900 text-white hover:bg-slate-800 shadow-slate-900/30',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-600/20',
  danger: 'bg-rose-500 text-white hover:bg-rose-600 shadow-rose-500/30',
  outline: 'bg-transparent border border-slate-200 text-slate-600 hover:border-slate-300',
  ghost: 'bg-transparent text-slate-400 hover:text-blue-500',
};

const Button = ({ 
  children, 
  onClick, 
  variant = 'primary', 
  className = '', 
  disabled = false, 
  loading = false,
  type = 'button',
  ...props 
}) => {
  const variantClasses = VARIANTS[variant] || VARIANTS.primary;
  
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`
        px-5 py-3 rounded-2xl font-bold text-[10px] uppercase tracking-[0.3em] 
        transition-all duration-200 shadow-lg 
        disabled:opacity-60 disabled:cursor-not-allowed
        flex items-center justify-center gap-2
        ${variantClasses}
        ${className}
      `}
      {...props}
    >
      {loading ? (
        <span className="animate-pulse">Processing...</span>
      ) : children}
    </button>
  );
};

export default Button;
