/**
 * window.tonconnect — injected into the MAIN world of every page.
 *
 * The @tonconnect/sdk library checks for window.tonconnect on init.
 * If present it uses this injected bridge instead of the HTTP SSE bridge.
 *
 * Communication with the extension is via window.postMessage:
 *   request:  { type: "tonconnect-request", id, method, params }
 *   response: { type: "tonconnect-response", id, result }
 */
(function () {
  if (window.tonconnect && window.tonconnect._isNile) return;

  let _requestId = 0;
  const _pending = new Map();
  const _listeners = {};
  let _connected = false;
  let _address = null;
  let _publicKey = null;

  function _send(method, params) {
    return new Promise((resolve, reject) => {
      const id = String(++_requestId);
      const timer = setTimeout(() => {
        _pending.delete(id);
        reject(new Error("tonconnect-timeout"));
      }, 300000);

      _pending.set(id, { resolve, reject, timer });
      window.postMessage(
        { type: "tonconnect-request", id, method, params: params || {} },
        "*",
      );
    });
  }

  function _emit(event, data) {
    (_listeners[event] || []).forEach(function (cb) {
      try {
        cb(data);
      } catch (e) {
        console.error("tonconnect listener error:", e);
      }
    });
  }

  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    if (ev.data?.type !== "tonconnect-response") return;

    var entry = _pending.get(ev.data.id);
    if (!entry) return;
    _pending.delete(ev.data.id);
    clearTimeout(entry.timer);

    var r = ev.data.result;
    if (r && r.ok) {
      entry.resolve(r);
    } else {
      entry.reject(new Error(r?.error || "tonconnect-request-failed"));
    }
  });

  var provider = {
    _isNile: true,

    connect: function (protocol, message) {
      return _send("tonconnect.connect", {
        protocol: protocol,
        message: message,
      }).then(function (r) {
        if (r.address) {
          _connected = true;
          _address = r.address;
          _publicKey = r.publicKey || null;
          _emit("connect", {
            address: r.address,
            publicKey: r.publicKey,
            walletStateInit: r.walletStateInit,
          });
          _emit("authTonAddress", { address: r.address });
        }
        return r;
      });
    },

    send: function (message, options) {
      return _send("tonconnect.send", {
        message: message,
        options: options,
      });
    },

    disconnect: function () {
      return _send("tonconnect.disconnect", {}).then(function (r) {
        _connected = false;
        _address = null;
        _publicKey = null;
        _emit("disconnect");
        return r;
      });
    },

    restoreConnection: function () {
      return _send("tonconnect.restoreConnection", {}).then(function (r) {
        if (r && r.address) {
          _connected = true;
          _address = r.address;
          _publicKey = r.publicKey || null;
          _emit("connect", {
            address: r.address,
            publicKey: r.publicKey,
            walletStateInit: r.walletStateInit,
          });
        }
        return r;
      });
    },

    on: function (event, callback) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(callback);
    },

    off: function (event, callback) {
      if (!_listeners[event]) return;
      _listeners[event] = _listeners[event].filter(function (cb) {
        return cb !== callback;
      });
    },

    listen: function (callback) {
      this.on("connect", callback);
    },

    sendListen: function () {},
  };

  window.tonconnect = provider;
  window.dispatchEvent(new Event("tonconnect-loaded"));
})();
