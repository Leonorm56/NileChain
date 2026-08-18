import { cn } from "@/utils";

export default function StatusIcon({ icon: Icon, status, ...props }) {
  return (
    <div
      {...props}
      className={cn(
        "p-2 rounded-full shrink-0",
        {
          success: ["text-green-800 dark:text-green-900", "bg-green-100"],
          error: ["text-red-800 dark:text-red-900", "bg-red-100"],
          pending: ["text-nile-gold-800 dark:text-nile-gold-900", "bg-nile-gold-100"],
        }[status],
        props.className
      )}
    >
      <Icon className="size-5" />
    </div>
  );
}



