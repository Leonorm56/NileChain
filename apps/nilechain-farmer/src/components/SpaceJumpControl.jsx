import { useState, useEffect } from "react";
import { cn } from "@/utils";

export default function SpaceJumpControl({ compact = false }) {
  const [targetScore, setTargetScore] = useState(500);
  const [status, setStatus] = useState("");
  const [liveScore, setLiveScore] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [gameTabId, setGameTabId] = useState(null);

  useEffect(() => {
    let mounted = true;
    let interval = null;

    const findAndPoll = async () => {
      try {
        const tabs = await chrome.tabs.query({});
        const gameTab = tabs.find(
          (t) => t.url && (t.url.includes("mywebapp.ru/SpaceJump") || t.url.includes("jump.mywebapp.ru"))
        );

        if (!gameTab) {
          if (mounted) {
            setGameTabId(null);
            setLiveScore(0);
            setIsPlaying(false);
          }
          return;
        }

        if (mounted) setGameTabId(gameTab.id);

        try {
          const response = await chrome.tabs.sendMessage(gameTab.id, {
            type: "spacejump:command",
            action: "getStatus",
          });
          if (mounted && response) {
            setLiveScore(response.score || 0);
            setIsPlaying(response.autoPlayEnabled || false);
          }
        } catch (e) {
          if (mounted) {
            setLiveScore(0);
            setIsPlaying(false);
          }
        }
      } catch (e) {}
    };

    findAndPoll();
    interval = setInterval(findAndPoll, 1500);

    return () => {
      mounted = false;
      if (interval) clearInterval(interval);
    };
  }, []);

  const sendCommand = async (action, value) => {
    if (!gameTabId) {
      setStatus("No game");
      return;
    }

    try {
      await chrome.tabs.sendMessage(gameTabId, {
        type: "spacejump:command",
        action,
        value,
      });
      if (action === "setTargetScore") {
        setStatus(`Target: ${value}`);
      } else if (action === "enableAutoPlay") {
        setStatus("Started");
      } else if (action === "disableAutoPlay") {
        setStatus("Stopped");
      }
      setTimeout(() => setStatus(""), 1500);
    } catch (err) {
      setStatus("Error");
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-mono text-nile-gold-400 min-w-[40px]">
          {liveScore}
        </span>
        <button
          onClick={() => sendCommand("enableAutoPlay")}
          disabled={isPlaying || !gameTabId}
          className={cn(
            "px-2 py-0.5 text-xs rounded font-medium",
            isPlaying
              ? "bg-green-700 text-green-300 cursor-default"
              : "bg-green-600 hover:bg-green-500 text-white"
          )}
        >
          {isPlaying ? "ON" : "START"}
        </button>
        <button
          onClick={() => sendCommand("disableAutoPlay")}
          disabled={!isPlaying}
          className={cn(
            "px-2 py-0.5 text-xs rounded font-medium",
            !isPlaying
              ? "bg-neutral-700 text-neutral-400 cursor-default"
              : "bg-red-600 hover:bg-red-500 text-white"
          )}
        >
          STOP
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 p-2 bg-nile-800/50 rounded border border-nile-700">
      <span className="text-sm font-mono text-nile-gold-400 font-bold">
        {liveScore}
      </span>

      <input
        type="number"
        value={targetScore}
        onChange={(e) => setTargetScore(parseInt(e.target.value) || 500)}
        className="w-16 px-1 py-0.5 bg-nile-900 border border-nile-600 rounded text-white text-xs"
        placeholder="Target"
      />

      <button
        onClick={() => sendCommand("setTargetScore", targetScore)}
        className="px-2 py-0.5 bg-nile-600 hover:bg-nile-500 text-white text-xs rounded"
      >
        Set
      </button>

      <button
        onClick={() => sendCommand("enableAutoPlay")}
        disabled={isPlaying}
        className={cn(
          "px-2 py-0.5 text-xs rounded font-medium",
          isPlaying
            ? "bg-green-700 text-green-300"
            : "bg-green-600 hover:bg-green-500 text-white"
        )}
      >
        START
      </button>

      <button
        onClick={() => sendCommand("disableAutoPlay")}
        className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white text-xs rounded font-medium"
      >
        STOP
      </button>

      {status && (
        <span className="text-xs text-nile-300">{status}</span>
      )}
    </div>
  );
}