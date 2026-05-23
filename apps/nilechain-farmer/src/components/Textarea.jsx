import { cn } from "@/utils";
import { memo } from "react";
import TextareaAutosize from "react-textarea-autosize";

export default memo(function Textarea(props) {
  return (
    <TextareaAutosize
      {...props}
      className={cn(
        "border bg-white/70 dark:bg-white/[0.06] backdrop-blur-md shadow-sm",
        "p-2.5 rounded-lg font-bold w-full min-w-0",
        "focus:outline-hidden focus:ring-3 focus:ring-blue-300",
        "disabled:opacity-50",
        props.className
      )}
    />
  );
});


