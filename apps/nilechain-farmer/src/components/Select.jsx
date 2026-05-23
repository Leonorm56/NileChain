import { cn } from "@/utils";
import { memo } from "react";

const Select = memo(function Select(props) {
  return (
    <select
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

const SelectItem = memo(function SelectItem(props) {
  return <option {...props} className="border shadow-sm bg-white/80 dark:bg-white/[0.04]" />;
});

Select.Item = SelectItem;

export default Select;


