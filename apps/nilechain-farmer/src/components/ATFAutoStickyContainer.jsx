import { cn } from "@/utils";

export default function ATFAutoStickyContainer(props) {
  return (
    <div
      {...props}
      className={cn(
        "-mx-2 -my-3 sticky top-0",
        "flex flex-col p-2",
        "border shadow-sm bg-white/80 dark:bg-white/[0.04] backdrop-blur-xl",
        props.className,
      )}
    />
  );
}


