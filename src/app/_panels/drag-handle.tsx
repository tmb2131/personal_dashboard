"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type DragHandleProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isDragging?: boolean;
};

export const DragHandle = forwardRef<HTMLButtonElement, DragHandleProps>(
  function DragHandle({ className, isDragging, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label="Drag to move task"
        tabIndex={-1}
        {...props}
        className={cn(
          "shrink-0 cursor-grab touch-none text-fg-subtle opacity-0 transition-opacity duration-150 hover:text-fg-muted focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing motion-reduce:transition-none",
          isDragging && "cursor-grabbing opacity-100",
          className,
        )}
      >
        <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden>
          <g fill="currentColor">
            <circle cx="2" cy="2.5" r="1.1" />
            <circle cx="8" cy="2.5" r="1.1" />
            <circle cx="2" cy="7" r="1.1" />
            <circle cx="8" cy="7" r="1.1" />
            <circle cx="2" cy="11.5" r="1.1" />
            <circle cx="8" cy="11.5" r="1.1" />
          </g>
        </svg>
      </button>
    );
  },
);
