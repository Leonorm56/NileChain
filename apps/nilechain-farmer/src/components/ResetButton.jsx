import { cn } from "@/utils";
import { memo } from "react";
import { HiArrowPath } from "react-icons/hi2";

export default memo(function ResetButton(props) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex items-center justify-center",
        "px-4 rounded-lg shrink-0",
        "border bg-white/70 dark:bg-white/[0.06] backdrop-blur-md shadow-sm",
        "disabled:opacity-50",
        props.className
      )}
    >
      <HiArrowPath className="w-4 h-4 " />
    </button>
  );
});


