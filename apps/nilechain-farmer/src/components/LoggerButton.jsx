import { useState } from "react";
import { HiOutlineArrowPath } from "react-icons/hi2";
import toast from "react-hot-toast";

import PrimaryButton from "./PrimaryButton";
import storage from "@/lib/storage";
import useAppContext from "@/hooks/useAppContext";
import { loginWebFromLocalSession, interceptCodeFromSession } from "@/lib/logger";

/**
 * LOGGER — per-account button: uses the stored local-telegram-session
 * (StringSession) to log the same account into Telegram Web K without needing
 * a new code from Spider.
 *
 * Primary path: resolve a valid DC 2 auth key (migrating the authorization
 * when the session lives on another DC) and inject it into Web K.
 * Fallback: intercept the 5-digit code from 777000 via NewMessage.
 */
export default function LoggerButton({ accountId, onDone }) {
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

      /* Primary: DC-migrated auth key injection — no code needed */
      const { accountNumber, user } = await loginWebFromLocalSession({
        sessionString,
        messaging,
        setActiveTab,
        closeTab,
      });

      toast.success(
        `LOGGER: logged into Web K as ${user?.username ? "@" + user.username : "account" + accountNumber}`,
      );
      onDone?.(accountNumber);
    } catch (e) {
      console.error("[LOGGER] direct injection failed:", e);

      /* Fallback: intercept the code from 777000 — user triggers Web K's
       * "send code" for the same phone and we capture it automatically. */
      toast.error(e?.message || "LOGGER: web login failed. Try requesting a code on Web K and use Intercept.");

      try {
        const sessionString = await storage.get(`account-${accountId}:local-telegram-session`);
        if (sessionString) {
          toast.loading("LOGGER: listening for code from 777000 (60s)...", { id: "intercept-code" });
          const intercepted = await interceptCodeFromSession(sessionString, 60000);
          toast.dismiss("intercept-code");
          setCode(intercepted);
          toast.success(`LOGGER: code intercepted: ${intercepted} — enter it on Web K`);
        }
      } catch (ie) {
        toast.dismiss("intercept-code");
        console.error("[LOGGER] intercept failed:", ie);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <PrimaryButton onClick={handleLogin} disabled={loading}>
        <HiOutlineArrowPath className={`size-5 ${loading ? "animate-spin" : ""}`} />
        {loading ? "LOGGER: logging into Web..." : "LOGGER — Login to Web from Local Session"}
      </PrimaryButton>
      {code && (
        <p className="text-center text-sm font-mono bg-neutral-100 dark:bg-neutral-800 rounded px-2 py-1">
          Code from 777000: <span className="font-bold text-nile-gold-500">{code}</span>
        </p>
      )}
    </div>
  );
}