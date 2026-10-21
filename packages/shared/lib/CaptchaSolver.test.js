import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import CaptchaSolver from "./CaptchaSolver.js";

/* Fake Boterdrop-Solver: GET /turnstile -> 202 {task_id},
   GET /result?id= -> 202 twice, then 200 success. */
function startFakeSolver() {
  let polls = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://fake");
    if (url.pathname === "/turnstile") {
      assert.equal(url.searchParams.get("url"), "https://app.mrgtoken.xyz/");
      assert.equal(url.searchParams.get("sitekey"), "0x4TESTKEY");
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ task_id: "task-1", status: "accepted" }));
    } else if (url.pathname === "/result") {
      assert.equal(url.searchParams.get("id"), "task-1");
      polls += 1;
      if (polls < 3) {
        res.writeHead(202, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "process" }));
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ status: "success", elapsed_time: 2.4, value: "TOKEN123" }),
        );
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function startFailingSolver(body, code) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://fake");
    if (url.pathname === "/turnstile") {
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ task_id: "task-9", status: "accepted" }));
    } else {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

describe("CaptchaSolver boterdrop provider", () => {
  it("is accepted and configured with a base URL", () => {
    const solver = new CaptchaSolver("boterdrop", "http://127.0.0.1:8000");
    assert.equal(solver.isConfigured(), true);
  });

  it("solves turnstile via create + poll", async () => {
    const server = await startFakeSolver();
    try {
      const port = server.address().port;
      const solver = new CaptchaSolver("boterdrop", `http://127.0.0.1:${port}`);
      const token = await solver.solveTurnstile({
        siteKey: "0x4TESTKEY",
        pageUrl: "https://app.mrgtoken.xyz/",
      });
      assert.equal(token, "TOKEN123");
    } finally {
      server.close();
    }
  });

  it("throws on solver error", async () => {
    const server = await startFailingSolver(
      { status: "error", value: "captcha_fail" },
      422,
    );
    try {
      const port = server.address().port;
      const solver = new CaptchaSolver("boterdrop", `http://127.0.0.1:${port}`);
      await assert.rejects(
        solver.solveTurnstile({ siteKey: "k", pageUrl: "https://x.test/" }),
        /captcha_fail/,
      );
    } finally {
      server.close();
    }
  });
});

/* Fake EzSolver: POST /solve -> 200 {token}. */
function startFakeEzSolver(response, code = 200) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://fake");
    if (url.pathname === "/solve" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        assert.equal(parsed.sitekey, "0x4TESTKEY");
        assert.equal(parsed.siteurl, "https://app.mrgtoken.xyz/");
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(response));
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

describe("CaptchaSolver ezsolver provider", () => {
  it("is accepted and configured with a base URL", () => {
    const solver = new CaptchaSolver("ezsolver", "http://127.0.0.1:8191");
    assert.equal(solver.isConfigured(), true);
  });

  it("solves turnstile via single POST /solve", async () => {
    const server = await startFakeEzSolver({ token: "EZTOKEN", elapsed: 5.1 });
    try {
      const port = server.address().port;
      const solver = new CaptchaSolver("ezsolver", `http://127.0.0.1:${port}`);
      const token = await solver.solveTurnstile({
        siteKey: "0x4TESTKEY",
        pageUrl: "https://app.mrgtoken.xyz/",
      });
      assert.equal(token, "EZTOKEN");
    } finally {
      server.close();
    }
  });

  it("throws on solver error", async () => {
    const server = await startFakeEzSolver(
      { error: "Turnstile token not obtained within 45s" },
      500,
    );
    try {
      const port = server.address().port;
      const solver = new CaptchaSolver("ezsolver", `http://127.0.0.1:${port}`);
      await assert.rejects(
        solver.solveTurnstile({
          siteKey: "0x4TESTKEY",
          pageUrl: "https://app.mrgtoken.xyz/",
        }),
        /not obtained/,
      );
    } finally {
      server.close();
    }
  });
});
