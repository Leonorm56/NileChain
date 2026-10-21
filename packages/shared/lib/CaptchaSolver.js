import axios from "axios";

export default class CaptchaSolver {
  constructor(provider, apiKey) {
    this.provider = provider;
    this.apiKey = apiKey;

    let baseURL = "";
    let taskBased = false;
    let taskType = "";
    let authProperty = "";
    let boterdrop = false;
    let ezsolver = false;

    switch (this.provider) {
      case "2captcha":
        baseURL = "https://2captcha.com";
        break;

      case "captchaai":
        baseURL = "https://ocr.captchaai.com";
        break;

      case "solvecaptcha":
        baseURL = "https://api.solvecaptcha.com";
        break;

      case "captchasonic":
        taskBased = true;
        authProperty = "apiKey";
        taskType = "AntiTurnstileTaskProxyLess";
        baseURL = "https://api.captchasonic.com";
        break;

      case "nocaptchaai":
        taskBased = true;
        authProperty = "clientKey";
        taskType = "AntiTurnstileTask";
        baseURL = "https://api.nocaptchaai.com";
        break;

      case "boterdrop":
        /* Self-hosted Boterdrop-Solver: 2nd constructor arg is its base URL,
           e.g. new CaptchaSolver("boterdrop", "http://127.0.0.1:8000") */
        boterdrop = true;
        baseURL = (apiKey || "").replace(/\/+$/, "");
        break;

      case "ezsolver":
        /* Local EzSolver: 2nd constructor arg is its base URL,
           e.g. new CaptchaSolver("ezsolver", "http://127.0.0.1:8191") */
        ezsolver = true;
        baseURL = (apiKey || "").replace(/\/+$/, "");
        break;

      default:
        throw new Error(`Unsupported captcha provider: ${this.provider}`);
    }

    this.boterdrop = boterdrop;
    this.ezsolver = ezsolver;

    this.taskBased = taskBased;
    this.authProperty = authProperty;
    this.taskType = taskType;
    this.api = axios.create({
      baseURL: baseURL,
      timeout: 120_000,
    });
  }

  /** Check if configured */
  isConfigured() {
    return Boolean(this.provider && this.apiKey);
  }

  /** Get Turnstile Request */
  getTurnstileRequest({ siteKey, pageUrl }) {
    if (this.taskBased) {
      return this.api
        .post("/createTask", {
          [this.authProperty]: this.apiKey,
          task: {
            type: this.taskType,
            websiteURL: pageUrl,
            websiteKey: siteKey,
          },
        })
        .then((res) => ({
          ...res.data,
          request: res.data.taskId,
        }));
    } else {
      return this.api
        .post("/in.php", {
          key: this.apiKey,
          method: "turnstile",
          sitekey: siteKey,
          pageurl: pageUrl,
          json: 1,
        })
        .then((res) => res.data);
    }
  }

  /** Get Turnstile Result */
  getTurnstileResult(requestId) {
    if (this.taskBased) {
      return this.api
        .post("/getTaskResult", {
          [this.authProperty]: this.apiKey,
          taskId: requestId,
        })
        .then((res) => {
          return {
            status: res.data.errorId === 0 ? 1 : 0,
            request: res.data.solution ? res.data.solution.token : null,
          };
        });
    } else {
      return this.api
        .get("/res.php", {
          params: {
            key: this.apiKey,
            action: "get",
            id: requestId,
            json: 1,
          },
        })
        .then((res) => res.data);
    }
  }

  /** Solve Turnstile */
  async solveTurnstile({ siteKey, pageUrl, action, cdata }) {
    if (this.boterdrop) {
      return this.solveTurnstileViaBoterdrop({ siteKey, pageUrl, action, cdata });
    }
    if (this.ezsolver) {
      return this.solveTurnstileViaEzSolver({ siteKey, pageUrl });
    }

    const response = await this.getTurnstileRequest({ siteKey, pageUrl });
    const requestId = response.request;

    /* Wait for 20 seconds before polling for the result */
    await new Promise((resolve) => setTimeout(resolve, 20_000));

    while (true) {
      const result = await this.getTurnstileResult(requestId);
      if (result.status === 1) {
        return result.request; /* Captcha solved */
      } else if (result.request === "CAPCHA_NOT_READY") {
        /* Wait for 5 seconds before polling again */
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      } else {
        throw new Error(`Captcha solving failed: ${result.request}`);
      }
    }
  }

  /** Solve Turnstile via self-hosted Boterdrop-Solver.
   * Creates a task with GET /turnstile then polls GET /result until the
   * solver answers 200 (success) or an error status (408/422/404/500). */
  async solveTurnstileViaBoterdrop(
    { siteKey, pageUrl, action, cdata },
    { pollInterval = 1_000, timeout = 300_000 } = {},
  ) {
    const create = await this.api.get("/turnstile", {
      params: {
        url: pageUrl,
        sitekey: siteKey,
        ...(action ? { action } : {}),
        ...(cdata ? { cdata } : {}),
      },
      validateStatus: () => true,
    });
    const taskId = create.data?.task_id;
    if (create.status !== 202 || !taskId) {
      throw new Error(
        `Captcha solving failed: create returned ${create.status}`,
      );
    }

    const startedAt = Date.now();
    for (;;) {
      if (Date.now() - startedAt > timeout) {
        throw new Error("Captcha solving failed: timeout");
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      const res = await this.api.get("/result", {
        params: { id: taskId },
        validateStatus: () => true,
      });
      if (res.status === 200 && res.data?.status === "success" && res.data?.value) {
        return res.data.value;
      }
      if (res.status === 202) {
        continue; /* Still solving */
      }
      throw new Error(
        `Captcha solving failed: ${res.data?.message || res.data?.value || `http ${res.status}`}`,
      );
    }
  }

  /** Solve Turnstile via local EzSolver.
   * Single call: POST /solve {sitekey, siteurl} -> 200 {token}. */
  async solveTurnstileViaEzSolver({ siteKey, pageUrl }, { timeout = 90 } = {}) {
    const res = await this.api.post(
      "/solve",
      { sitekey: siteKey, siteurl: pageUrl, timeout },
      { validateStatus: () => true },
    );
    if (res.status === 200 && res.data?.token) {
      return res.data.token;
    }
    throw new Error(
      `Captcha solving failed: ${res.data?.error || `http ${res.status}`}`,
    );
  }
}
