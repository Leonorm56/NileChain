import { cn } from "@/utils";
import { forwardRef, memo } from "react";

/** Toolbar Button */
const ToolbarButton = memo(
  forwardRef(({ icon: Icon, children, ...props }, ref) => (
    <button
      {...props}
      ref={ref}
      className={cn(
        "p-2 rounded-full shrink-0",
        "border bg-neutral-900 dark:bg-neutral-800",
        "hover:bg-neutral-100 dark:hover:bg-neutral-600",

        props.className
      )}
    >
      <Icon className="size-5" />
      {children}
    </button>
  ))
);

export default ToolbarButton;



