import db from "../db/models/index.js";
import farmers from "../farmers/index.js";

/**
 * Battery sweep — charges flat Rignite batteries between full cycles.
 * Only touches accounts under 20% that still have ad quota; everything
 * else is a cheap login-and-skip. Self-throttling via the daily quota.
 */
export default async function batterySweep() {
  const Rignite = farmers["rignite"];
  if (!Rignite) return;

  const accounts = await db.Account.findSubscribedWithFarmer("rignite");
  const list = accounts.filter((a) => !a.farmer?.isBanned);
  let flat = 0;
  let charged = 0;

  for (const account of list) {
    const inst = new Rignite(account);
    try {
      await inst.prepare();
      const u = await inst.login();
      const cap = Number(u.batteryCap) || 0;
      const cur = Number(u.batteryEnergy) || 0;
      if (cap <= 0 || Math.round((cur / cap) * 100) >= 20) continue;
      flat++;
      if ((Number(u.batteryAdLeft) || 0) <= 0) continue;
      const ok = await inst.watchBatteryAd();
      if (ok) charged++;
    } catch {
      // per-account failure — next account
    } finally {
      try {
        await inst.client?.disconnect?.();
      } catch {}
    }
  }

  console.log(`🔋 Battery sweep: flat=${flat} charged=${charged}`);
}
