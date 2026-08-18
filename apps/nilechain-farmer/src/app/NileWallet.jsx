import Container from "@/components/Container";
import NileWalletConnectModal from "@/components/NileWalletConnectModal";
import copy from "copy-to-clipboard";
import { Address } from "@ton/core";
import nileWalletClient, {
  NileWalletLockedError,
} from "@/lib/nileWalletClient";
import toast from "react-hot-toast";
import useAccountContext from "@/hooks/useAccountContext";
import { QRCodeSVG } from "qrcode.react";
import { cn } from "@/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  HiOutlineArrowDownTray,
  HiOutlineArrowLeft,
  HiOutlineArrowPath,
  HiOutlineArrowUpRight,
  HiOutlineArrowUpTray,
  HiOutlineCheckCircle,
  HiOutlineClipboard,
  HiOutlineEye,
  HiOutlineLockClosed,
  HiOutlineLockOpen,
  HiOutlinePaperAirplane,
  HiOutlinePlus,
  HiOutlineTrash,
  HiOutlineXMark,
} from "react-icons/hi2";
import TonCoinIcon from "@/assets/images/toncoin-ton-logo.svg";
import Button from "@/components/Button";
import Input from "@/components/Input";
import PasswordInput from "@/components/PasswordInput";

const CARD =
  "border bg-white/70 dark:bg-white/[0.06] backdrop-blur-md shadow-sm rounded-xl";

/** Truncate a TON address for display. */
function truncate(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-6)}` : "";
}

/* -------------------------------------------------------------------------- */
/* Vault unlock / passphrase                                                   */
/* -------------------------------------------------------------------------- */

function UnlockForm({ configured, submitLabel, onUnlocked, busy }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const unlockMutation = useMutation({
    mutationFn: (pass) => nileWalletClient.unlock(pass),
  });

  const submit = useCallback(
    (ev) => {
      ev.preventDefault();
      if (!password) return;
      if (!configured && password !== confirm) {
        toast.error("Passphrases do not match");
        return;
      }
      unlockMutation
        .mutateAsync(password)
        .then(() => {
          setPassword("");
          setConfirm("");
          onUnlocked?.();
        })
        .catch((error) => {
          toast.error(
            error?.code === "bad-passphrase"
              ? "Wrong passphrase"
              : error?.message || "Failed to unlock",
          );
        });
    },
    [password, confirm, configured, unlockMutation, onUnlocked],
  );

  const pending = busy || unlockMutation.isPending;

  return (
    <form onSubmit={submit} className={cn(CARD, "flex flex-col gap-2 p-4")}>
      <h3 className="font-bold">
        {configured ? "Unlock NileWallet" : "Set a vault passphrase"}
      </h3>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        {configured
          ? "Enter your vault passphrase to continue."
          : "One passphrase secures every account's wallet on this device. It is never stored — you'll re-enter it after the extension restarts."}
      </p>

      <PasswordInput
        autoFocus
        value={password}
        placeholder="Vault passphrase"
        onChange={(e) => setPassword(e.target.value)}
        disabled={pending}
      />
      {!configured ? (
        <PasswordInput
          value={confirm}
          placeholder="Confirm passphrase"
          onChange={(e) => setConfirm(e.target.value)}
          disabled={pending}
        />
      ) : null}

      <Button type="submit" disabled={pending || !password}>
        {pending ? "Please wait…" : submitLabel || "Unlock"}
      </Button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Reveal phrase                                                               */
/* -------------------------------------------------------------------------- */

function RevealPhrase({ accountId, unlocked, onNeedsUnlock }) {
  const [confirmed, setConfirmed] = useState(false);
  const [phrase, setPhrase] = useState(null);

  const revealMutation = useMutation({
    mutationFn: () => nileWalletClient.revealSeed(accountId),
  });

  const reveal = useCallback(() => {
    revealMutation
      .mutateAsync()
      .then((res) => setPhrase(res.phrase))
      .catch((error) => {
        if (error instanceof NileWalletLockedError) {
          onNeedsUnlock?.();
        } else {
          toast.error(error?.message || "Failed to reveal phrase");
        }
      });
  }, [revealMutation, onNeedsUnlock]);

  const hide = useCallback(() => {
    setPhrase(null);
    setConfirmed(false);
  }, []);

  const words = useMemo(() => (phrase ? phrase.split(" ") : []), [phrase]);

  if (phrase) {
    return (
      <div className={cn(CARD, "flex flex-col gap-3 p-4")}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold">Recovery Phrase</h3>
          <button
            type="button"
            onClick={hide}
            className="text-sm font-bold text-nile-gold-500"
          >
            Hide
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {words.map((word, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 px-2 py-1.5 text-sm rounded-lg bg-black/5 dark:bg-white/[0.06]"
            >
              <span className="text-neutral-400 tabular-nums">{i + 1}.</span>
              <span className="font-bold">{word}</span>
            </div>
          ))}
        </div>

        <QRCodeSVG
          value={phrase}
          title="Recovery phrase"
          bgColor="#ffffff"
          fgColor="#000000"
          level="M"
          size={160}
          className="self-center"
        />

        <button
          type="button"
          onClick={() => {
            copy(phrase);
            toast.success("Copied recovery phrase");
          }}
          className="text-sm font-bold text-nile-gold-500"
        >
          Copy phrase
        </button>
      </div>
    );
  }

  return (
    <div className={cn(CARD, "flex flex-col gap-2 p-4")}>
      <h3 className="font-bold">Reveal Recovery Phrase</h3>
      {!confirmed ? (
        <>
          <p className="text-sm text-red-500">
            Anyone with these 24 words controls this wallet. Never share them.
            Make sure no one is watching your screen.
          </p>
          <Button variant="danger" onClick={() => setConfirmed(true)}>
            I understand — continue
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {unlocked
              ? "Tap to display your recovery phrase."
              : "Unlock the vault first to reveal your phrase."}
          </p>
          <Button
            onClick={reveal}
            disabled={revealMutation.isPending}
          >
            <HiOutlineEye className="size-4" />
            {revealMutation.isPending ? "Revealing…" : "Reveal Phrase"}
          </Button>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Connect via link                                                            */
/* -------------------------------------------------------------------------- */

function ConnectViaLink({ accountId, onPrepared, onNeedsUnlock }) {
  const [link, setLink] = useState("");

  const parseMutation = useMutation({
    mutationFn: (value) => nileWalletClient.parseLink(accountId, value),
  });

  const submit = useCallback(
    (ev) => {
      ev.preventDefault();
      const value = link.trim();
      if (!value) return;
      parseMutation
        .mutateAsync(value)
        .then((res) => {
          setLink("");
          onPrepared(res.prepared);
        })
        .catch((error) => {
          if (error instanceof NileWalletLockedError) {
            onNeedsUnlock?.();
          } else {
            toast.error(error?.message || "Invalid connect link");
          }
        });
    },
    [link, parseMutation, onPrepared, onNeedsUnlock],
  );

  return (
    <form onSubmit={submit} className={cn(CARD, "flex flex-col gap-2 p-4")}>
      <h3 className="font-bold">Connect via link</h3>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Paste a TON Connect link (<code>tc://…</code>) from a bot mini-app to
        connect this wallet.
      </p>
      <Input
        value={link}
        placeholder="tc://?v=2&id=…"
        onChange={(e) => setLink(e.target.value)}
        disabled={parseMutation.isPending}
        className="font-mono text-sm font-normal"
      />
      <Button type="submit" disabled={parseMutation.isPending || !link.trim()}>
        {parseMutation.isPending ? "Reading link…" : "Connect"}
      </Button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Custom tokens (Jettons)                                                     */
/* -------------------------------------------------------------------------- */

function TokensSection({ accountId }) {
  const [showForm, setShowForm] = useState(false);
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");

  const tokensQuery = useQuery({
    queryKey: ["nile-wallet-tokens", accountId],
    queryFn: () => nileWalletClient.listTokens(accountId),
    enabled: Boolean(accountId),
  });
  const tokens = tokensQuery.data?.tokens || [];

  const balancesQuery = useQuery({
    queryKey: ["nile-wallet-token-balances", accountId, tokens],
    queryFn: () =>
      Promise.all(
        tokens.map((token) =>
          nileWalletClient
            .tokenBalance(accountId, token)
            .then((res) => ({
              jetton_master_address: token.jetton_master_address,
              balance: res.balance,
            }))
            .catch(() => ({
              jetton_master_address: token.jetton_master_address,
              balance: null,
            })),
        ),
      ),
    enabled: Boolean(accountId) && tokens.length > 0,
    refetchInterval: 30_000,
  });

  const balanceByMaster = useMemo(() => {
    const map = {};
    for (const row of balancesQuery.data || []) {
      map[row.jetton_master_address] = row.balance;
    }
    return map;
  }, [balancesQuery.data]);

  const addMutation = useMutation({
    mutationFn: (value) => nileWalletClient.addToken(accountId, value),
  });

  const removeMutation = useMutation({
    mutationFn: (value) => nileWalletClient.removeToken(accountId, value),
  });

  const submit = useCallback(
    (ev) => {
      ev.preventDefault();
      const value = address.trim();
      if (!value) return;
      setError("");
      addMutation
        .mutateAsync(value)
        .then(() => {
          setAddress("");
          setShowForm(false);
          tokensQuery.refetch();
          balancesQuery.refetch();
        })
        .catch((err) => setError(err?.message || "Invalid token address"));
    },
    [address, addMutation, tokensQuery, balancesQuery],
  );

  const remove = useCallback(
    (value) => {
      removeMutation
        .mutateAsync(value)
        .then(() => {
          tokensQuery.refetch();
          balancesQuery.refetch();
        })
        .catch(() => toast.error("Failed to remove token"));
    },
    [removeMutation, tokensQuery, balancesQuery],
  );

  const format = useCallback((raw, decimals) => {
    try {
      const value = BigInt(raw);
      const divisor = 10n ** BigInt(decimals);
      const whole = value / divisor;
      const fraction = (value % divisor)
        .toString()
        .padStart(decimals, "0")
        .replace(/0+$/, "");
      return fraction ? `${whole}.${fraction}` : whole.toString();
    } catch {
      return raw;
    }
  }, []);

  if (!tokens.length && !showForm) {
    return (
      <div className={cn(CARD, "flex flex-col gap-2 p-4")}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold">Tokens</h3>
          <Button onClick={() => setShowForm(true)}>
            <HiOutlinePlus className="size-4" />
            Add Token
          </Button>
        </div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          No custom tokens tracked. Add a Jetton by its contract address to
          watch its balance here.
        </p>
      </div>
    );
  }

  return (
    <div className={cn(CARD, "flex flex-col gap-3 p-4")}>
      <div className="flex items-center justify-between">
        <h3 className="font-bold">Tokens</h3>
        <Button onClick={() => setShowForm((v) => !v)}>
          <HiOutlinePlus className="size-4" />
          {showForm ? "Close" : "Add Token"}
        </Button>
      </div>

      {showForm ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <Input
            autoFocus
            value={address}
            placeholder="Jetton master address (EQ…)"
            onChange={(e) => setAddress(e.target.value)}
            disabled={addMutation.isPending}
            className="font-mono text-sm font-normal"
          />
          {error ? (
            <p className="text-xs text-red-500">{error}</p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={addMutation.isPending || !address.trim()}
            >
              {addMutation.isPending ? "Adding…" : "Add"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowForm(false);
                setAddress("");
                setError("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {tokensQuery.isLoading ? (
        <p className="text-sm text-neutral-400">Loading tokens…</p>
      ) : (
        <div className="flex flex-col gap-2">
          {tokens.map((token) => (
            <div
              key={token.jetton_master_address}
              className={cn(
                "flex items-center gap-3 p-2 rounded-lg",
                "bg-black/5 dark:bg-white/[0.06]",
              )}
            >
              {token.icon_url ? (
                <img
                  src={token.icon_url}
                  className="size-8 rounded-full shrink-0 bg-white/10 object-cover"
                  alt={token.symbol}
                />
              ) : (
                <div className="flex items-center justify-center size-8 rounded-full shrink-0 bg-nile-gold-500/10 border border-nile-gold-500/30 text-xs font-bold text-nile-gold-500">
                  {token.symbol?.slice(0, 2).toUpperCase() || "?"}
                </div>
              )}
              <div className="flex flex-col min-w-0 grow">
                <span className="font-bold truncate">{token.name}</span>
                <span className="text-xs text-neutral-400">
                  {token.symbol}
                </span>
              </div>
              <span className="font-mono text-sm font-bold shrink-0">
                {balanceByMaster[token.jetton_master_address] == null
                  ? balancesQuery.isLoading
                    ? "…"
                    : "—"
                  : `${format(
                      balanceByMaster[token.jetton_master_address],
                      token.decimals,
                    )} ${token.symbol}`}
              </span>
              <button
                type="button"
                onClick={() => remove(token.jetton_master_address)}
                disabled={removeMutation.isPending}
                className="text-neutral-400 hover:text-red-500 disabled:opacity-50"
                title={`Remove ${token.symbol}`}
              >
                <HiOutlineXMark className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Send                                                                        */
/* -------------------------------------------------------------------------- */

const TON_DECIMALS = 9;
const TON_RESERVE_NANO = 50000000n; // 0.05 TON kept back by the MAX shortcut

/**
 * Cheap pre-check so we don't spam the SW; the background validates fully.
 * Uses @ton/core's Address.parse (handles EQ/UQ bounceable & non-bounceable
 * encodings natively — no manual prefix checking) and normalizes both to the
 * same address. The authoritative check + send still runs in the service
 * worker with the parsed Address object.
 */
function isValidRecipient(value) {
  try {
    Address.parse(value.trim());
    return true;
  } catch {
    return false;
  }
}

function decimalToRaw(amount, decimals) {
  const s = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Invalid amount");
  const [whole, fraction = ""] = s.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Too many decimals (max ${decimals})`);
  }
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

function rawToDecimal(raw, decimals) {
  const value = BigInt(raw);
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(decimals, "0");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

function nanoToTonString(nano) {
  return rawToDecimal(nano, TON_DECIMALS);
}

function tonStringToNano(value) {
  const s = String(value).trim();
  const [whole, fraction = ""] = s.split(".");
  const padded = (fraction + "0".repeat(TON_DECIMALS)).slice(0, TON_DECIMALS);
  return BigInt(whole || "0") * 10n ** BigInt(TON_DECIMALS) + BigInt(padded || "0");
}

function SendSection({
  accountId,
  walletAddress,
  tonBalance,
  unlocked,
  onNeedsUnlock,
  onSent,
}) {
  const [asset, setAsset] = useState("ton");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estError, setEstError] = useState(null);
  const [result, setResult] = useState(null);
  const estimateSeqRef = useRef(0);

  const queryClient = useQueryClient();

  const tokensQuery = useQuery({
    queryKey: ["nile-wallet-tokens", accountId],
    queryFn: () => nileWalletClient.listTokens(accountId),
    enabled: Boolean(accountId),
  });
  const tokens = tokensQuery.data?.tokens || [];
  const activeToken =
    asset !== "ton"
      ? tokens.find((t) => t.jetton_master_address === asset) || null
      : null;
  const decimals = activeToken ? Number(activeToken.decimals) || 9 : TON_DECIMALS;

  const jettonBalanceQuery = useQuery({
    queryKey: ["nile-wallet-token-balance-single", accountId, activeToken?.jetton_master_address],
    queryFn: () =>
      nileWalletClient.tokenBalance(accountId, activeToken).then((r) => r.balance),
    enabled: Boolean(accountId) && Boolean(activeToken),
    refetchInterval: 30_000,
  });

  const toTrimmed = to.trim();
  const canEstimate = useMemo(() => {
    if (!isValidRecipient(toTrimmed) || !amount) return false;
    try {
      return decimalToRaw(amount, decimals) > 0n;
    } catch {
      return false;
    }
  }, [toTrimmed, amount, decimals]);

  /** Debounced fee estimate while the form is valid. */
  useEffect(() => {
    if (!canEstimate) {
      setEstimate(null);
      setEstError(null);
      return;
    }
    const seq = ++estimateSeqRef.current;
    const timer = setTimeout(() => {
      const kind = activeToken ? "jetton" : "ton";
      nileWalletClient
        .estimateTransfer(accountId, {
          kind,
          token: activeToken,
          to: toTrimmed,
          amount,
        })
        .then((res) => {
          if (estimateSeqRef.current !== seq) return;
          setEstimate(res);
          setEstError(null);
        })
        .catch((error) => {
          if (estimateSeqRef.current !== seq) return;
          if (error instanceof NileWalletLockedError) {
            onNeedsUnlock?.();
          } else {
            setEstimate(null);
            setEstError(error?.message || "Estimate failed");
          }
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [canEstimate, activeToken, toTrimmed, amount, accountId, onNeedsUnlock]);

  const fillMax = useCallback(() => {
    if (activeToken) {
      const raw = jettonBalanceQuery.data;
      if (raw == null) return;
      setAmount(rawToDecimal(raw, decimals));
    } else {
      let nano = tonStringToNano(tonBalance || "0");
      nano = nano > TON_RESERVE_NANO ? nano - TON_RESERVE_NANO : 0n;
      setAmount(nanoToTonString(nano));
    }
  }, [activeToken, jettonBalanceQuery.data, tonBalance, decimals]);

  const sendMutation = useMutation({
    mutationFn: () =>
      nileWalletClient.sendTransfer(accountId, {
        kind: activeToken ? "jetton" : "ton",
        token: activeToken,
        to: toTrimmed,
        amount,
      }),
  });

  const confirmSend = useCallback(() => {
    sendMutation
      .mutateAsync()
      .then((res) => {
        setConfirming(false);
        setResult(res);
        onSent?.();
      })
      .catch((error) => {
        setConfirming(false);
        if (error instanceof NileWalletLockedError) {
          onNeedsUnlock?.();
        } else {
          toast.error(error?.message || "Failed to send");
        }
      });
  }, [sendMutation, onNeedsUnlock, onSent]);

  const reset = useCallback(() => {
    setConfirming(false);
    setResult(null);
    setEstimate(null);
    setEstError(null);
    setTo("");
    setAmount("");
  }, []);

  const feeDisplay = estimate
    ? `~${nanoToTonString(estimate.feeNano)} TON`
    : null;

  /* Success state */
  if (result) {
    return (
      <div className={cn(CARD, "flex flex-col gap-3 p-4")}>
        <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
          <HiOutlineCheckCircle className="size-5" />
          <h3 className="font-bold">
            {result.txStatus === "confirmed" ? "Sent!" : "Broadcasting…"}
          </h3>
        </div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {result.txStatus === "confirmed"
            ? "The transfer was included in a block."
            : "The transfer was accepted by the network and is pending confirmation."}
        </p>
        <div className="flex flex-col gap-1 p-2 rounded-lg bg-black/5 dark:bg-white/[0.06]">
          <span className="text-xs text-neutral-400">Transaction hash</span>
          <span className="font-mono text-xs break-all">{result.hash}</span>
        </div>
        <a
          href={`https://tonscan.org/address/${walletAddress}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm font-bold text-nile-gold-500"
        >
          View on explorer <HiOutlineArrowUpRight className="size-4" />
        </a>
        <Button onClick={reset}>Done</Button>
      </div>
    );
  }

  return (
    <div className={cn(CARD, "flex flex-col gap-3 p-4")}>
      <div className="flex items-center justify-between">
        <h3 className="font-bold">Send</h3>
        <span className="text-xs text-neutral-400">
          {asset === "ton"
            ? `${tonBalance || "0"} TON available`
            : `${activeToken?.symbol || "—"} available: ${
                jettonBalanceQuery.data == null
                  ? "…"
                  : rawToDecimal(jettonBalanceQuery.data, decimals)
              }`}
        </span>
      </div>

      {/* Asset picker */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setAsset("ton")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold border",
            asset === "ton"
              ? "border-nile-gold-500 bg-nile-gold-500/10 text-nile-gold-500"
              : "border-neutral-300 dark:border-white/10 text-neutral-500 dark:text-neutral-400",
          )}
        >
          <img src={TonCoinIcon} className="size-4" alt="" /> TON
        </button>
        {tokens.map((token) => (
          <button
            key={token.jetton_master_address}
            type="button"
            onClick={() => setAsset(token.jetton_master_address)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold border",
              asset === token.jetton_master_address
                ? "border-nile-gold-500 bg-nile-gold-500/10 text-nile-gold-500"
                : "border-neutral-300 dark:border-white/10 text-neutral-500 dark:text-neutral-400",
            )}
          >
            {token.icon_url ? (
              <img
                src={token.icon_url}
                className="size-4 rounded-full bg-white/10 object-cover"
                alt=""
              />
            ) : (
              <span className="inline-flex items-center justify-center size-4 rounded-full bg-nile-gold-500/10 text-[9px] font-bold text-nile-gold-500">
                {token.symbol?.slice(0, 2).toUpperCase() || "?"}
              </span>
            )}
            {token.symbol}
          </button>
        ))}
      </div>

      <Input
        value={to}
        placeholder="Recipient address (EQ or UQ…)"
        onChange={(e) => setTo(e.target.value)}
        className="font-mono text-sm font-normal"
      />

      <div className="flex gap-2">
        <Input
          value={amount}
          placeholder={activeToken ? "Amount" : "Amount (TON)"}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          className="font-mono text-sm font-normal"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={fillMax}
          disabled={!unlocked}
        >
          MAX
        </Button>
      </div>

      {estError ? <p className="text-xs text-red-500">{estError}</p> : null}
      {estimate?.insufficient ? (
        <p className="text-xs text-red-500">{estimate.insufficient}</p>
      ) : null}

      {feeDisplay ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Network fee <span className="font-bold">{feeDisplay}</span>
          {estimate?.insufficient ? " · insufficient balance" : ""}
        </p>
      ) : null}

      {confirming ? (
        <div className="flex flex-col gap-2 p-3 rounded-lg bg-black/5 dark:bg-white/[0.06]">
          <p className="text-sm">
            Send{" "}
            <span className="font-bold">
              {amount} {activeToken?.symbol || "TON"}
            </span>{" "}
            to <span className="font-mono text-xs break-all">{toTrimmed}</span>?
          </p>
          {feeDisplay ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Network fee {feeDisplay}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              variant="danger"
              onClick={confirmSend}
              disabled={sendMutation.isPending}
            >
              {sendMutation.isPending ? "Sending…" : "Confirm"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirming(false)}
              disabled={sendMutation.isPending}
            >
              Back
            </Button>
          </div>
        </div>
      ) : (
        <Button
          onClick={() => setConfirming(true)}
          disabled={
            !unlocked || !canEstimate || sendMutation.isPending
          }
        >
          <HiOutlinePaperAirplane className="size-4" />
          {!unlocked ? "Unlock to send" : "Send"}
        </Button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Wallet setup: create new / import existing                                 */
/* -------------------------------------------------------------------------- */

function WalletSetup({ accountId, generate, generating, onNeedsUnlock, onImported }) {
  const [mode, setMode] = useState(null); // null = choose | "import" | "restore"
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState("");

  const importMutation = useMutation({
    mutationFn: (value) => nileWalletClient.importWallet(accountId, value),
  });

  const words = useMemo(
    () => phrase.trim().split(/\s+/).filter(Boolean),
    [phrase],
  );
  const count = words.length;

  const submit = useCallback(
    (ev) => {
      ev.preventDefault();
      if (count !== 24 || importMutation.isPending) return;
      setError("");
      importMutation
        .mutateAsync(phrase.trim().replace(/\s+/g, " "))
        .then(() => {
          setPhrase(""); // never keep the plaintext phrase around
          onImported?.();
        })
        .catch((err) => {
          setPhrase("");
          if (err instanceof NileWalletLockedError) {
            onNeedsUnlock?.();
          } else {
            setError(err?.message || "Invalid recovery phrase");
          }
        });
    },
    [count, phrase, importMutation, onImported, onNeedsUnlock],
  );

  /* ---- choice ---- */
  if (mode === null) {
    return (
      <div className={cn(CARD, "flex flex-col gap-2 p-4 text-center")}>
        <img src={TonCoinIcon} className="size-12 mx-auto" alt="" />
        <h3 className="font-bold">No wallet on this account</h3>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Create a fresh TON wallet or import one from an existing recovery
          phrase. Either way it is encrypted locally — nothing leaves this
          device.
        </p>
        <div className="flex flex-col gap-2">
          <Button onClick={generate} disabled={generating}>
            {generating ? "Creating…" : "Create New Wallet"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setMode("import")}
            disabled={generating}
          >
            Import Existing Wallet
          </Button>
          <Button
            variant="secondary"
            onClick={() => setMode("restore")}
            disabled={generating}
          >
            <HiOutlineArrowUpTray className="size-4" />
            Restore from backup file
          </Button>
        </div>
      </div>
    );
  }

  /* ---- restore ---- */
  if (mode === "restore") {
    return (
      <div className={cn(CARD, "flex flex-col gap-3 p-4")}>
        <RestoreSection
          onNeedsUnlock={onNeedsUnlock}
          onRestored={onImported}
          onClose={() => {
            setError("");
            setPhrase("");
            setMode(null);
          }}
        />
      </div>
    );
  }

  /* ---- import ---- */
  return (
    <form
      onSubmit={submit}
      className={cn(CARD, "flex flex-col gap-3 p-4")}
    >
      <div className="flex items-center justify-between">
        <h3 className="font-bold">Import Existing Wallet</h3>
        <button
          type="button"
          onClick={() => {
            setMode(null);
            setError("");
            setPhrase("");
          }}
          disabled={importMutation.isPending}
          className="text-sm font-bold text-nile-gold-500 disabled:opacity-50"
        >
          Back
        </button>
      </div>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Enter the 24-word recovery phrase of the wallet you want to import. It
        is validated locally and never stored in plaintext.
      </p>
      <textarea
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        rows={3}
        placeholder="24 words separated by spaces"
        disabled={importMutation.isPending}
        autoFocus
        className={cn(
          "border bg-white/70 dark:bg-white/[0.06] backdrop-blur-md shadow-sm",
          "p-2.5 rounded-lg w-full min-w-0 resize-y",
          "font-mono text-sm font-normal",
          "focus:outline-hidden focus:ring-3 focus:ring-nile-gold-400",
          "disabled:opacity-50",
        )}
      />
      <p className="text-xs text-neutral-400 tabular-nums">
        {count} / 24 words
      </p>
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        Imports as a V4R2 wallet. If the phrase was exported from a wallet using
        V3R2, the derived address will differ — double-check before moving
        funds.
      </p>
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={count !== 24 || importMutation.isPending}
        >
          {importMutation.isPending ? "Importing…" : "Import Wallet"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setMode(null);
            setError("");
            setPhrase("");
          }}
          disabled={importMutation.isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Backup / Restore                                                            */
/* -------------------------------------------------------------------------- */

/** Trigger a browser download from the app page (fallback when the SW download API is unavailable). */
function downloadJson(filename, json) {
  // data: URL — no URL.createObjectURL dependency (may be unavailable).
  const dataUrl = `data:application/json;base64,${btoa(
    unescape(encodeURIComponent(json)),
  )}`;
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function RestoreSection({ onNeedsUnlock, onRestored, onClose }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [fileJson, setFileJson] = useState("");
  const [preview, setPreview] = useState(null);
  const [overwrite, setOverwrite] = useState({});
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const reset = useCallback(() => {
    setPassword("");
    setFileName("");
    setFileJson("");
    setPreview(null);
    setOverwrite({});
    setError("");
    setBusy(false);
    onClose?.();
  }, [onClose]);

  const onFile = useCallback((ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setFileJson(String(reader.result || ""));
      setFileName(file.name);
      setPreview(null);
      setOverwrite({});
      setError("");
    };
    reader.readAsText(file);
    ev.target.value = "";
  }, []);

  const doPreview = useCallback(
    (ev) => {
      ev.preventDefault();
      setBusy(true);
      setError("");
      nileWalletClient
        .restorePreview(password, fileJson)
        .then((res) => {
          setPreview(res);
          setOverwrite(
            Object.fromEntries(
              res.entries
                .filter((e) => e.exists)
                .map((e) => [e.account_id, false]),
            ),
          );
        })
        .catch((e) => {
          if (e instanceof NileWalletLockedError) onNeedsUnlock?.();
          else setError(e?.message || "Failed to read backup");
        })
        .finally(() => setBusy(false));
    },
    [password, fileJson, onNeedsUnlock],
  );

  const doRestore = useCallback(() => {
    setBusy(true);
    setError("");
    nileWalletClient
      .restoreApply(password, fileJson, overwrite)
      .then((res) => {
        toast.success(
          `Restored ${res.restored} wallet${res.restored === 1 ? "" : "s"}${
            res.skipped ? ` (${res.skipped} skipped)` : ""
          }`,
        );
        onRestored?.();
        reset();
      })
      .catch((e) => {
        if (e instanceof NileWalletLockedError) onNeedsUnlock?.();
        else setError(e?.message || "Restore failed");
      })
      .finally(() => setBusy(false));
  }, [password, fileJson, overwrite, onRestored, onNeedsUnlock, reset]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">Restore from backup file</h3>
        {onClose ? (
          <button
            type="button"
            onClick={reset}
            className="text-sm font-bold text-nile-gold-500"
          >
            Close
          </button>
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={onFile}
      />
      <Button
        variant="secondary"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy || Boolean(preview)}
      >
        <HiOutlineArrowUpTray className="size-4" />
        {fileName ? `File: ${fileName}` : "Choose backup file (.json)"}
      </Button>

      {!preview ? (
        <form onSubmit={doPreview} className="flex flex-col gap-2">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Enter the passphrase that was used to create this backup.
          </p>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Backup passphrase"
            disabled={busy}
          />
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
          <Button type="submit" disabled={busy || !password || !fileJson}>
            {busy ? "Decrypting…" : "Decrypt &amp; Preview"}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Found {preview.entries.length} wallet
            {preview.entries.length === 1 ? "" : "s"} in the backup:
          </p>
          <div className="flex flex-col gap-1.5">
            {preview.entries.map((entry) => (
              <div
                key={entry.account_id}
                className="flex items-center gap-2 p-2 rounded-lg bg-black/5 dark:bg-white/[0.06]"
              >
                <div className="flex flex-col min-w-0 grow">
                  <span className="font-mono text-xs truncate">
                    {entry.address}
                  </span>
                  <span className="text-xs text-neutral-400">
                    {entry.account_id}
                    {entry.token_count
                      ? ` · ${entry.token_count} token${
                          entry.token_count === 1 ? "" : "s"
                        }`
                      : ""}
                  </span>
                </div>
                {entry.exists ? (
                  <label className="flex items-center gap-1.5 text-xs text-nile-gold-500 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={Boolean(overwrite[entry.account_id])}
                      disabled={busy}
                      onChange={(ev) =>
                        setOverwrite((o) => ({
                          ...o,
                          [entry.account_id]: ev.target.checked,
                        }))
                      }
                    />
                    Overwrite
                  </label>
                ) : (
                  <span className="text-xs text-green-600 dark:text-green-400 shrink-0">
                    New
                  </span>
                )}
              </div>
            ))}
          </div>
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
          <p className="text-xs text-nile-gold-600 dark:text-nile-gold-400">
            Existing wallets are only replaced where you tick Overwrite.
          </p>
          <div className="flex gap-2">
            <Button onClick={doRestore} disabled={busy}>
              {busy ? "Restoring…" : "Restore"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPreview(null)}
              disabled={busy}
            >
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function BackupSection({ onNeedsUnlock, onRestored }) {
  const [mode, setMode] = useState(null); // null | "backup" | "restore"
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = useCallback(() => {
    setMode(null);
    setPassword("");
    setError("");
    setBusy(false);
  }, []);

  const doBackup = useCallback(
    (ev) => {
      ev.preventDefault();
      setBusy(true);
      setError("");
      nileWalletClient
        .backup(password)
        .then((res) => {
          // Fallback path: SW handed the JSON back when downloads API is absent.
          if (res.json) downloadJson(res.filename, res.json);
          toast.success("Backup file downloaded");
        })
        .catch((e) => {
          if (e instanceof NileWalletLockedError) onNeedsUnlock?.();
          else if (e?.code === "bad-passphrase") setError("Wrong passphrase");
          else setError(e?.message || "Backup failed");
        })
        .finally(() => setBusy(false));
    },
    [password, onNeedsUnlock],
  );

  return (
    <div className={cn(CARD, "flex flex-col gap-3 p-4")}>
      <div className="flex items-center justify-between">
        <h3 className="font-bold">Backup &amp; Restore</h3>
        {mode ? (
          <button
            type="button"
            onClick={reset}
            className="text-sm font-bold text-nile-gold-500"
          >
            Close
          </button>
        ) : null}
      </div>

      {mode === null ? (
        <>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Export every account's wallet to an encrypted file, or restore from
            one. The file is useless without your vault passphrase.
          </p>
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => {
                setError("");
                setPassword("");
                setMode("backup");
              }}
            >
              <HiOutlineArrowDownTray className="size-4" />
              Backup Wallets
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setError("");
                setPassword("");
                setMode("restore");
              }}
            >
              <HiOutlineArrowUpTray className="size-4" />
              Restore Wallets
            </Button>
          </div>
          <p className="text-xs text-red-500/80">
            Losing both the backup file and the passphrase means permanent loss
            of funds — there is no recovery path beyond that.
          </p>
        </>
      ) : mode === "backup" ? (
        <form onSubmit={doBackup} className="flex flex-col gap-2">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Enter your vault passphrase to encrypt the export. It is never
            stored in the file.
          </p>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Vault passphrase"
            disabled={busy}
          />
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
          <Button type="submit" disabled={busy || !password}>
            <HiOutlineArrowDownTray className="size-4" />
            {busy ? "Encrypting…" : "Download backup file"}
          </Button>
        </form>
      ) : (
        <RestoreSection
          onNeedsUnlock={onNeedsUnlock}
          onRestored={onRestored}
          onClose={reset}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                      */
/* -------------------------------------------------------------------------- */

export default function NileWallet() {
  const account = useAccountContext();
  const accountId = account?.id;
  const queryClient = useQueryClient();

  const [pendingConnect, setPendingConnect] = useState(null);
  const [showUnlock, setShowUnlock] = useState(false);

  const vaultQuery = useQuery({
    queryKey: ["nile-vault-status"],
    queryFn: () => nileWalletClient.vaultStatus(),
  });

  const walletQuery = useQuery({
    queryKey: ["nile-wallet", accountId],
    queryFn: () => nileWalletClient.get(accountId),
    enabled: Boolean(accountId),
  });

  const wallet = walletQuery.data;
  const hasWallet = Boolean(wallet?.status && wallet?.address);
  const unlocked = Boolean(vaultQuery.data?.unlocked);
  const configured = Boolean(vaultQuery.data?.configured);

  const balanceQuery = useQuery({
    queryKey: ["nile-wallet-balance", accountId, wallet?.address],
    queryFn: () => nileWalletClient.balance(accountId),
    enabled: Boolean(accountId) && hasWallet,
    refetchInterval: 30_000,
  });

  const refreshVault = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["nile-vault-status"] }),
    [queryClient],
  );

  const generateMutation = useMutation({
    mutationFn: () => nileWalletClient.generate(accountId),
  });

  const clearMutation = useMutation({
    mutationFn: () => nileWalletClient.clear(accountId),
  });

  const approveMutation = useMutation({
    mutationFn: (prepared) => nileWalletClient.approve(accountId, prepared),
  });

  const rejectMutation = useMutation({
    mutationFn: (prepared) => nileWalletClient.reject(accountId, prepared),
  });

  /** Generate a wallet (unlocking/setting the passphrase first if needed). */
  const generate = useCallback(() => {
    generateMutation
      .mutateAsync()
      .then(() => {
        toast.success("Wallet created");
        walletQuery.refetch();
        refreshVault();
      })
      .catch((error) => {
        if (error instanceof NileWalletLockedError) {
          setShowUnlock(true);
        } else {
          toast.error(error?.message || "Failed to create wallet");
        }
      });
  }, [generateMutation, walletQuery, refreshVault]);

  /** Listen for connect requests forwarded by the service worker. */
  useEffect(() => {
    if (!accountId || !chrome?.runtime?.onMessage) return;
    const handler = (message) => {
      if (
        message?.action === "nile-wallet.connect.request" &&
        message.accountId === accountId &&
        message.request?.transport === "bridge" &&
        message.request?.dAppPubKey
      ) {
        // Initial connect request surfaced from discovery — show the modal.
        if (message.request.items || message.request.manifest) {
          setPendingConnect(message.request);
        }
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [accountId]);

  const approve = useCallback(() => {
    if (!pendingConnect) return;
    approveMutation
      .mutateAsync(pendingConnect)
      .then(() => {
        toast.success("Wallet connected");
        setPendingConnect(null);
        queryClient.invalidateQueries({
          queryKey: ["nile-wallet-sessions", accountId],
        });
      })
      .catch((error) => {
        if (error instanceof NileWalletLockedError) {
          setShowUnlock(true);
        } else {
          toast.error(error?.message || "Failed to connect");
        }
      });
  }, [pendingConnect, approveMutation, queryClient, accountId]);

  const reject = useCallback(() => {
    const prepared = pendingConnect;
    setPendingConnect(null);
    if (prepared) rejectMutation.mutate(prepared);
  }, [pendingConnect, rejectMutation]);

  if (!accountId) {
    return (
      <Container className="text-center">
        <p>No account selected.</p>
      </Container>
    );
  }

  return (
    <Container className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <img src={TonCoinIcon} className="size-7" alt="" />
        <h2 className="text-xl font-bold font-turret-road text-nile-gold-500">
          NileWallet
        </h2>
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-neutral-400">
          {unlocked ? (
            <>
              <HiOutlineLockOpen className="size-3.5" /> Unlocked
            </>
          ) : (
            <>
              <HiOutlineLockClosed className="size-3.5" /> Locked
            </>
          )}
        </span>
      </div>

      {walletQuery.isLoading ? (
        <p className="text-center text-neutral-400">Loading wallet…</p>
      ) : !hasWallet ? (
        /* ---- No wallet yet ---- */
        <>
          {unlocked ? (
            <WalletSetup
              accountId={accountId}
              generate={generate}
              generating={generateMutation.isPending}
              onNeedsUnlock={() => setShowUnlock(true)}
              onImported={() => {
                walletQuery.refetch();
                refreshVault();
              }}
            />
          ) : (
            <UnlockForm
              configured={configured}
              submitLabel={configured ? "Unlock" : "Set passphrase"}
              busy={vaultQuery.isLoading}
              onUnlocked={() => {
                refreshVault();
                // Auto-create right after the very first passphrase setup.
                if (!configured) generate();
              }}
            />
          )}
        </>
      ) : (
        /* ---- Wallet exists ---- */
        <>
          {/* Balance + address card */}
          <div className={cn(CARD, "flex flex-col gap-3 p-4")}>
            <div className="flex items-center gap-2">
              <img src={TonCoinIcon} className="size-6" alt="" />
              <span className="text-sm text-neutral-500 dark:text-neutral-400">
                Balance
              </span>
              <button
                type="button"
                onClick={() => balanceQuery.refetch()}
                className="ml-auto text-neutral-400 hover:text-nile-gold-500"
                title="Refresh balance"
              >
                <HiOutlineArrowPath
                  className={cn(
                    "size-4",
                    balanceQuery.isFetching && "animate-spin",
                  )}
                />
              </button>
            </div>

            <div className="text-3xl font-bold">
              {balanceQuery.isLoading
                ? "…"
                : balanceQuery.data?.error
                  ? "—"
                  : `${balanceQuery.data?.balance ?? "0"} TON`}
            </div>

            <button
              type="button"
              onClick={() => {
                copy(wallet.address);
                toast.success("Address copied");
              }}
              className={cn(
                "flex items-center gap-2 p-2 rounded-lg text-left",
                "bg-black/5 dark:bg-white/[0.06]",
              )}
            >
              <span className="font-mono text-sm truncate grow">
                {wallet.address}
              </span>
              <HiOutlineClipboard className="size-4 shrink-0 text-neutral-400" />
            </button>
            <p className="text-xs text-neutral-400 -mt-1">
              {truncate(wallet.address)} · non-bounceable (UQ…) · tap to copy
            </p>
          </div>

          {/* Send */}
          <SendSection
            accountId={accountId}
            walletAddress={wallet.address}
            tonBalance={balanceQuery.data?.balance}
            unlocked={unlocked}
            onNeedsUnlock={() => setShowUnlock(true)}
            onSent={() => {
              balanceQuery.refetch();
              queryClient.invalidateQueries({
                queryKey: ["nile-wallet-token-balances", accountId],
              });
            }}
          />

          {/* Locked banner */}
          {!unlocked ? (
            <UnlockForm
              configured={configured}
              submitLabel="Unlock"
              onUnlocked={() => {
                refreshVault();
                setShowUnlock(false);
              }}
            />
          ) : null}

          {/* Custom tokens (Jettons) */}
          <TokensSection accountId={accountId} />

          {/* Backup & restore */}
          <BackupSection
            onNeedsUnlock={() => setShowUnlock(true)}
            onRestored={() => {
              walletQuery.refetch();
              refreshVault();
              queryClient.invalidateQueries({
                queryKey: ["nile-wallet-tokens", accountId],
              });
            }}
          />

          {/* Connect via link */}
          <ConnectViaLink
            accountId={accountId}
            onPrepared={setPendingConnect}
            onNeedsUnlock={() => setShowUnlock(true)}
          />

          {/* Reveal phrase */}
          <RevealPhrase
            accountId={accountId}
            unlocked={unlocked}
            onNeedsUnlock={() => setShowUnlock(true)}
          />

          {/* Danger zone */}
          <div className={cn(CARD, "flex flex-col gap-2 p-4")}>
            <h3 className="font-bold text-red-500">Danger zone</h3>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Removing the wallet deletes its encrypted phrase and all TON
              Connect sessions for this account. This cannot be undone unless
              you saved the recovery phrase.
            </p>
            <Button
              variant="danger"
              disabled={clearMutation.isPending}
              onClick={() => {
                if (
                  !window.confirm(
                    "Remove this wallet? Make sure you've saved the recovery phrase.",
                  )
                )
                  return;
                clearMutation
                  .mutateAsync()
                  .then(() => {
                    toast.success("Wallet removed");
                    walletQuery.refetch();
                  })
                  .catch((error) =>
                    toast.error(error?.message || "Failed to remove wallet"),
                  );
              }}
            >
              <HiOutlineTrash className="size-4" />
              Remove wallet
            </Button>
          </div>
        </>
      )}

      {/* Unlock prompt triggered by a gated action */}
      {showUnlock && !unlocked ? (
        <UnlockForm
          configured={configured}
          submitLabel="Unlock"
          onUnlocked={() => {
            refreshVault();
            setShowUnlock(false);
          }}
        />
      ) : null}

      {/* Connect approval modal */}
      <NileWalletConnectModal
        open={Boolean(pendingConnect)}
        onOpenChange={(open) => {
          if (!open) reject();
        }}
        request={pendingConnect}
        address={wallet?.address}
        busy={approveMutation.isPending}
        onApprove={approve}
        onReject={reject}
      />
    </Container>
  );
}
