import { useState } from "react";
import toast from "react-hot-toast";
import PrimaryButton from "./PrimaryButton";
import storage from "@/lib/storage";
import useAppContext from "@/hooks/useAppContext";
import { loginWebFromLocalSession } from "@/lib/webLoginFromSession";
import { HiOutlineWrenchScrewdriver } from "react-icons/hi2";

/**
 * Batch-fixes already-bought Spider accounts that have
 * account-${id}:local-telegram-session but no valid WebK entry.
 * Iterates sequentially with a small delay to avoid FloodWait.
 */
export default function FixWebLoginBatchButton() {
  const { messaging, setActiveTab, closeTab, persistedAccounts } = useAppContext();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [target, setTarget] = useState("k");

  const handleFix = async () => {
    setRunning(true);
    let success = 0;
    let failed = 0;

    // Collect accounts that have a local session
    const candidates = [];
    for (const acc of persistedAccounts || []) {
      const s = await storage.get(`account-${acc.id}:local-telegram-session`);
      if (s) candidates.push(acc);
    }

    if (candidates.length === 0) {
      toast.error("No accounts with local sessions found.");
      setRunning(false);
      return;
    }

    setProgress({ done: 0, total: candidates.length });
    toast.loading(`Fixing ${candidates.length} accounts...`, { id: "fix-batch" });

    for (let i = 0; i < candidates.length; i++) {
      const acc = candidates[i];
      try {
        const s = await storage.get(`account-${acc.id}:local-telegram-session`);
        await loginWebFromLocalSession({
          sessionString: s,
          messaging,
          setActiveTab,
          closeTab,
          target,
        });
        success++;
      } catch (e) {
        console.error(`[FixBatch] ${acc.id} failed:`, e);
        failed++;
      }
      setProgress({ done: i + 1, total: candidates.length });
      // Longer delay to let Web tab/port fully close and avoid MTProto TL race
      await new Promise((r) => setTimeout(r, 2500));
    }

    toast.dismiss("fix-batch");
    toast.success(`Done: ${success} fixed, ${failed} failed`);
    setRunning(false);
  };

  return (
    <div className="flex flex-col gap-1">
      {/* Target selector */}
      <div className="flex gap-1 justify-center">
        {[
          ["k", "Web K"],
          ["a", "Web A"],
          ["both", "Both"],
        ].map(([val, label]) => (
          <button
            key={val}
            onClick={() => setTarget(val)}
            disabled={running}
            className={`px-3 py-1 rounded-full text-xs font-bold border ${
              target === val
                ? "bg-nile-gold-500 text-white border-nile-gold-500"
                : "bg-transparent text-neutral-500 border-neutral-300 dark:border-neutral-600"
            } disabled:opacity-50`}
          >
            {label}
          </button>
        ))}
      </div>

      <PrimaryButton onClick={handleFix} disabled={running}>
        <HiOutlineWrenchScrewdriver className={`size-5 ${running ? "animate-spin" : ""}`} />
        {running ? `Fixing ${progress.done}/${progress.total}...` : "Fix Web Login for Spider Accounts"}
      </PrimaryButton>
      <p className="text-xs text-center text-neutral-500">
        Uses each account&apos;s local session to re-inject its Web {target === "both" ? "K+A" : target.toUpperCase()} login. No code needed.
      </p>
    </div>
  );
}
