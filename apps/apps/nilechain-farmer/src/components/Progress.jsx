import { Progress as ProgressPrimitive } from "radix-ui";

const Progress = ({ current, max }) => {
  return (
    <>
      <ProgressPrimitive.Root
        value={current}
        className="w-full h-2 overflow-hidden border border-neutral-300 dark:border-neutral-600 rounded-full"
      >
        <ProgressPrimitive.Indicator
          className="bg-nile-gold-600 h-full transition-all duration-500"
          style={{ width: `${(current / max) * 100}%` }}
        />
      </ProgressPrimitive.Root>
      <p className="text-center text-nile-gold-400">
        {current} / {max}
      </p>
    </>
  );
};

export { Progress };



