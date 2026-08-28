import { useState } from "react";
import { HiOutlineArrowPath } from "react-icons/hi2";
import toast from "react-hot-toast";

import PrimaryButton from "./PrimaryButton";
import storage from "@/lib/storage";
import useAppContext from "@/hooks/useAppContext";
import { loginWebFromLocalSession, interceptCodeFromSession } from "@/lib/webLoginFromSession";

/**
 * Per-account button: uses the stored local-telegram-session (StringSession)
 * to log the same account into Telegram Web K without needing a new code
 * from Spider. Primary path: direct authKey injection (Spider.js:289 pattern).
 * Fallback: intercept 5-digit code from 777000 via NewMessage (TelegramLogin.jsx:72).
 */
export default function WebLoginFromSessionButton({ accountId, onDone }) {
  const { messaging, setActiveTab, closeTab } = useAppContext();
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState(null);

  const handleLogin = async () => {
    setLoading(true);
    setCode(null);
    try {
      const sessionString = await storage.get(`account-${accountId}:local-telegram-session`);

      if (!sessionString) {
        toast.error("No local session found for this account. Enable Local Telegram Session when buying.");
        return;
      }

      // Primary: direct authKey injection — no code needed
      const { accountNumber } = await loginWebFromLocalSession({
        sessionString,
        messaging,
        setActiveTab,
        closeTab,
      });

      toast.success(`Logged into Web K as account${accountNumber}`);
      onDone?.(accountNumber);
    } catch (e) {
      console.error("[WebLoginFromSession] direct injection failed:", e);

      // Fallback hint: offer code intercept if direct injection is rejected
      // The local client is already connected and listening on 777000 —
      // user can trigger Web K code request manually and we will capture it.
      toast.error(e?.message || "Web login failed. Try requesting a code on Web K and use Intercept.");

      // Optionally auto-start intercept so a code arriving within 60s is captured
      try {
        const sessionString = await storage.get(`account-${accountId}:local-telegram-session`);
        if (sessionString) {
          toast.loading("Listening for code from 777000 (60s)...", { id: "intercept-code" });
          const intercepted = await interceptCodeFromSession(sessionString, 60000);
          toast.dismiss("intercept-code");
          setCode(intercepted);
          toast.success(`Code intercepted: ${intercepted} — enter it on Web K`);
        }
      } catch (ie) {
        toast.dismiss("intercept-code");
        console.error("[WebLoginFromSession] intercept failed:", ie);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <PrimaryButton onClick={handleLogin} disabled={loading}>
        <HiOutlineArrowPath className={`size-5 ${loading ? "animate-spin" : ""}`} />
        {loading ? "Logging into Web..." : "Login to Web from Local Session"}
      </PrimaryButton>
      {code && (
        <p className="text-center text-sm font-mono bg-neutral-100 dark:bg-neutral-800 rounded px-2 py-1">
          Code from 777000: <span className="font-bold text-nile-gold-500">{code}</span>
        </p>
      )}
    </div>
  );
}
