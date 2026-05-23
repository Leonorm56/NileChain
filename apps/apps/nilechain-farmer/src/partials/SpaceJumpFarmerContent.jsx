import { useState, useEffect, useRef } from "react";
import Container from "@/components/Container";
import { Dialog } from "radix-ui";
import FarmerHeader from "@/components/FarmerHeader";
import TerminalArea from "@/components/TerminalArea";
import TerminalFarmerContext from "@/contexts/TerminalFarmerContext";
import { TerminalFarmerPrompt } from "./TerminalFarmerPrompt";
import { TerminalFarmerTools } from "./TerminalFarmerTools";
import { IoCopyOutline } from "react-icons/io5";
import { cn } from "@/utils";
import useMirroredState from "@/hooks/useMirroredState";
import useStorageState from "@/hooks/useStorageState";

export const SpaceJumpFarmerContent = ({ terminalFarmer }) => {
  const {
    isPrimaryFarmerUser,
    userInputPrompt,
    referralLink,
    terminalRef,
    context,
    started,
    toggle,
    instance,
  } = terminalFarmer;

  const [showToolsPanel, setShowToolsPanel, dispatchAndSetShowToolsPanel] =
    useMirroredState(`${context.id}.toggle-tools-panel`, false);

  const { value: balance } = useStorageState(
    `farmer-storage:${context.id}:${context.id}-balance`,
    null,
  );

  const [spaceJumpInfo, setSpaceJumpInfo] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);
  const [localStarted, setLocalStarted] = useState(false);
  const commandsSent = useRef(false);

  const { value: scoreRange, storeValue: setScoreRange } = useStorageState(
    `farmer-storage:${context.id}:score-range`,
    500,
  );

  const sendCommand = (action, value = null) => {
    try {
      chrome.runtime.sendMessage({ type: 'spacejump-command', action, value });
      console.log('[SpaceJumpFarmer] Sent command:', action, value);
    } catch (e) {
      console.error('[SpaceJumpFarmer] Command error:', e);
    }
  };

  const handleToggle = () => {
    const next = !localStarted;
    setLocalStarted(next);
    if (next && !commandsSent.current) {
      commandsSent.current = true;
      sendCommand('enableAutoPlay');
      sendCommand('setTargetScore', scoreRange);
      sendCommand('setAutoStopOnTarget', true);
    } else if (!next) {
      commandsSent.current = false;
      sendCommand('disableAutoPlay');
    }
  };

  useEffect(() => () => sendCommand('disableAutoPlay'), []);

  const tgUser = instance?.getTelegramUser?.();
  const username = tgUser?.username ? `@${tgUser.username}` : null;

  useEffect(() => {
    let mounted = true;

    const pollGameStatus = () => {
      if (!mounted) return;
      
      chrome.storage.local.get(['spacejumpData'], (result) => {
        if (!mounted) return;
        
        const data = result.spacejumpData;
        
        if (data?.userData) {
          setSpaceJumpInfo({
            coin: data.userData.coin ?? 0,
            bill: data.userData.bill ?? 0,
            games: data.userData.games_amount ?? 0,
            score: data.status?.score ?? 0,
            playing: data.status?.autoPlayEnabled ?? false,
          });
          setStatusMessage(null);
        } else {
          setStatusMessage("Waiting for game data...");
        }
      });
    };

    pollGameStatus();
    const interval = setInterval(pollGameStatus, 1000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  return (
    <TerminalFarmerContext.Provider value={terminalFarmer}>
      <div className="flex flex-col min-w-0 min-h-0 grow">
        <TerminalFarmerPrompt
          context={context}
          userInputPrompt={userInputPrompt}
        />

        <div className="flex items-center gap-2 pr-2 border-b dark:border-neutral-600">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => referralLink && navigator.clipboard.writeText(referralLink)}>
            <img src="/spacejump-icon.png" alt="SpaceJump" className="w-8 h-8 shrink-0 rounded-full" />
            <h1 className="font-bold">SpaceJump Farmer</h1>
            {referralLink ? (
              <IoCopyOutline className="shrink-0" />
            ) : null}
          </div>
        </div>

        {username && (
          <div className="px-2 py-1 text-xs text-center text-neutral-500">
            {username}
          </div>
        )}

        {balance ? (
          <div className="px-3 py-1 text-xs text-center dark:border-neutral-600 font-bold border-b dark:border-neutral-600">
            Balance: {balance}
          </div>
        ) : null}

        {spaceJumpInfo && (
          <div className="px-3 py-0.5 text-xs text-center bg-green-900/50 text-green-400 font-bold border-b dark:border-neutral-600">
            Score: {spaceJumpInfo.score} {spaceJumpInfo.playing ? " (Auto)" : ""}
          </div>
        )}

        {statusMessage && (
          <div className="px-3 py-0.5 text-xs text-center bg-yellow-900/50 text-yellow-400 border-b dark:border-neutral-600">
            {statusMessage}
          </div>
        )}

        <div className="flex flex-col p-2 gap-2">
          <div className="py-2 px-3 rounded-lg bg-neutral-900 border dark:border-neutral-600">
            <div className="text-center">
              <h3 className="text-lg font-bold">{spaceJumpInfo?.coin?.toLocaleString() || "0"}</h3>
              <p className="text-[10px] text-neutral-400 uppercase">COINS</p>
            </div>
          </div>

          <div className="flex justify-between gap-2 px-1">
            <div className="flex-1 py-1 px-2 rounded-lg bg-neutral-900/50 border border-neutral-700 text-center">
              <p className="text-sm font-bold ">{spaceJumpInfo?.bill?.toLocaleString() || "0"}</p>
              <p className="text-[10px] text-neutral-500">BILL</p>
            </div>
            <div className="flex-1 py-1 px-2 rounded-lg bg-neutral-900/50 border border-neutral-700 text-center">
              <p className="text-sm font-bold ">{spaceJumpInfo?.games || 0}</p>
              <p className="text-[10px] text-neutral-500">GAMES</p>
            </div>
          </div>

          <div className="py-1 px-2 rounded-lg bg-neutral-900/30 border border-neutral-700">
            <input
              min="1"
              max="1000"
              placeholder="1-1000"
              className="w-full px-2 py-1 rounded text-xs bg-neutral-800 border border-neutral-600 outline-0 text-center placeholder:text-neutral-600 focus:border-neutral-500"
              type="number"
              value={scoreRange || 500}
              onChange={(e) => setScoreRange(parseInt(e.target.value) || 500)}
            />
          </div>

          {localStarted && spaceJumpInfo && (
            <div className="py-1 px-2 rounded-lg bg-neutral-700/30 border border-neutral-600">
              <div className="flex items-center justify-center gap-1">
                <div className={`w-1.5 h-1.5 rounded-full ${spaceJumpInfo?.playing ? 'bg-green-500 animate-pulse' : 'bg-neutral-400'}`} />
                <p className="text-xs ">
                  {spaceJumpInfo?.score || 0}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-2 cursor-pointer px-2">
          <button
            onClick={handleToggle}
            className={cn(
              "px-12 py-2.5 rounded-lg font-medium",
              localStarted 
                ? "bg-red-600 hover:bg-red-700 text-white" 
                : "bg-nile-gold-600 hover:bg-nile-gold-700 text-neutral-900",
              "transition-colors",
            )}
          >
            {localStarted ? "Stop Auto-Play" : "Start Auto-Play"}
          </button>
        </div>

        <div className="py-2">
          <TerminalArea ref={terminalRef} />
        </div>

        <div className="flex gap-2 px-2 border-t dark:border-neutral-700 shrink-0" />
      </div>
    </TerminalFarmerContext.Provider>
  );
};