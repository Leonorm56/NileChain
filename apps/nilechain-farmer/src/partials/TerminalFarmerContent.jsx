import { HiOutlineWrenchScrewdriver, HiPlay, HiStop } from "react-icons/hi2";

import Container from "@/components/Container";
import { Dialog } from "radix-ui";
import FarmerHeader from "@/components/FarmerHeader";
import TerminalArea from "@/components/TerminalArea";
import TerminalFarmerContext from "@/contexts/TerminalFarmerContext";
import { TerminalFarmerPrompt } from "./TerminalFarmerPrompt";
import { TerminalFarmerTools } from "./TerminalFarmerTools";
import { SpaceJumpFarmerContent } from "./SpaceJumpFarmerContent";
import { cn } from "@/utils";
import useMirroredState from "@/hooks/useMirroredState";
import useStorageState from "@/hooks/useStorageState";
import useTerminalFarmer from "@/hooks/useTerminalFarmer";

export const TerminalFarmerContent = () => {
  const terminalFarmer = useTerminalFarmer();
  const {
    isPrimaryFarmerUser,
    userInputPrompt,
    referralLink,
    terminalRef,
    context,
    started,
    toggle,
  } = terminalFarmer;

  const [showToolsPanel, setShowToolsPanel, dispatchAndSetShowToolsPanel] =
    useMirroredState(`${context.id}.toggle-tools-panel`, false);

  const { value: balance } = useStorageState(
    `farmer-storage:${context.id}:${context.id}-balance`,
    null,
  );

  if (context.id === "spacejump") {
    return <SpaceJumpFarmerContent terminalFarmer={terminalFarmer} />;
  }

  return (
    <TerminalFarmerContext.Provider value={terminalFarmer}>
      <div className="flex flex-col min-w-0 min-h-0 grow">
        <TerminalFarmerPrompt
          context={context}
          userInputPrompt={userInputPrompt}
        />

        <div className="p-2 border-b dark:border-neutral-600">
          <FarmerHeader
            isPrimary={isPrimaryFarmerUser}
            referralLink={referralLink}
          />
        </div>

        {balance ? (
          <div className="px-3 py-1 text-xs text-center text-nile-gold-500 dark:text-nile-gold-400 font-bold border-b dark:border-neutral-600">
            Balance: {balance}
          </div>
        ) : null}

        <div className="py-2 text-center">
          <h3 className="text-xl font-bold">--</h3>
        </div>

        <Container className="flex gap-2 items-center p-0">
          <Dialog.Root
            open={showToolsPanel}
            onOpenChange={dispatchAndSetShowToolsPanel}
          >
            <Dialog.Trigger
              className={cn(
                "flex items-center justify-center gap-2 p-2 w-10 shrink-0",
                "hover:bg-neutral-100 dark:hover:bg-neutral-800",
                "text-nile-gold-500",
              )}
            >
              <HiOutlineWrenchScrewdriver className="size-5" />
            </Dialog.Trigger>
            <TerminalFarmerTools terminalFarmer={terminalFarmer} />
          </Dialog.Root>

          <button
            onClick={() => toggle(!started)}
            className={cn(
              "flex grow min-w-0 items-center justify-center gap-2 p-2",
              started ? "text-red-500" : "text-green-500",
            )}
          >
            {started ? (
              <HiStop className="size-5" />
            ) : (
              <HiPlay className="size-5" />
            )}
            {started ? "Stop" : "Start"}
          </button>

          <span className="w-10" />
        </Container>

        <TerminalArea ref={terminalRef} />
      </div>
    </TerminalFarmerContext.Provider>
  );
};