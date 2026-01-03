import React from 'react';

const Input = ({ 
  type = 'text', 
  className = '', 
  ...props 
}) => {
  return (
    <input
      type={type}
      className={`
        w-full 
        bg-slate-50 dark:bg-slate-800 
        border border-slate-100 dark:border-slate-700 
        rounded-2xl p-4 
        text-xs font-medium text-slate-900 dark:text-white
        outline-none 
        focus:border-blue-500/50 dark:focus:border-blue-400/50 
        transition-colors
        placeholder:text-slate-400 dark:placeholder:text-slate-500
        ${className}
      `}
      {...props}
    />
  );
};

export default Input;
