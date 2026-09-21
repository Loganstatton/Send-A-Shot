import { InputHTMLAttributes, forwardRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  rightAdornment?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, rightAdornment, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-text-muted">
            {label}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            className={cn(
              "w-full rounded-lg border border-border bg-surface-raised px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted/60 outline-none transition-colors focus:border-accent-sc",
              error && "border-danger focus:border-danger",
              rightAdornment && "pr-10",
              className
            )}
            {...props}
          />
          {rightAdornment && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted">{rightAdornment}</div>
          )}
        </div>
        {hint && !error && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>
    );
  }
);
Input.displayName = "Input";
