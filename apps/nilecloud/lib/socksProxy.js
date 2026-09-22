/**
 * Build the proxy object gramjs needs for a SOCKS5 connection.
 *
 * gramjs's socket layer only takes its SOCKS branch when the proxy object has
 * NO `MTProxy` key:
 *
 *   // we only want to use this when it's not an MTProto proxy.
 *   if (!("MTProxy" in proxy)) { ... this.proxy = proxy }
 *   else { this.proxy stays undefined -> plain direct socket }
 *
 * `parseProxy` used to always add `MTProxy: false`, so the proxy was ignored and
 * every account connected from this box's own IP — the one thing the
 * per-account proxies exist to avoid. Measured after dropping the key: a mint
 * over the proxy succeeds against a real session.
 */

/** Seconds a SOCKS dial gets. The old value was 2s. */
export const DEFAULT_SOCKS_TIMEOUT_SECONDS = 20;

/**
 * @param {string|null|undefined} proxy `user:pass@ip:port`
 * @param {number} [timeoutSeconds]
 * @returns {{ip: string, port: number, username: string, password: string, socksType: number, timeout: number}|null}
 */
export default function toSocksProxy(proxy, timeoutSeconds = DEFAULT_SOCKS_TIMEOUT_SECONDS) {
  if (!proxy) return null;

  const [creds, hostPort] = String(proxy).split("@");
  const [username, password] = (creds || "").split(":");
  const [ip, port] = (hostPort || "").split(":");

  const parsedPort = parseInt(port, 10);

  /** A half-parsed proxy must not be dialled: fail to "no proxy" instead */
  if (!ip || !Number.isFinite(parsedPort)) return null;

  return {
    ip,
    username,
    password,
    port: parsedPort,
    socksType: 5,
    timeout: timeoutSeconds,
  };
}
