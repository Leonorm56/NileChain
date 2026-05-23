import { cn } from "@/utils";
import { memo } from "react";

import Toggle from "./Toggle";

export default memo(function LabelToggle({ children, ...props }) {
  return (
    <label
      className={cn(
        "border bg-white/70 dark:bg-white/[0.06] backdrop-blur-md shadow-sm",
        "flex items-center gap-4 p-2 cursor-pointer rounded-xl",
        props.disabled && "opacity-50"
      )}
    >
      <h4 className="min-w-0 min-h-0 grow">{children}</h4> <Toggle {...props} />
    </label>
  );
});


