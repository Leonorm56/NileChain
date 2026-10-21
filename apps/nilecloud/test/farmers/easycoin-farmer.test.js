import * as assert from "node:assert";
import { test } from "node:test";

import EasyCoinFarmer from "@nile/shared/farmers/EasyCoinFarmer.js";

/** Anything chalk-ish the logger hands out (chalk.bold.red(...), logger.c.green). */
const inertChain = new Proxy(function () {}, {
  get: () => inertChain,
  apply: (_self, _this, args) => args[0] ?? "",
});

/** A logger that swallows the farmer's output but returns usable values. */
function silentLogger() {
  return {
    log: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    success: () => {},
    newline: () => {},
    keyValue: () => {},
    output: () => {},
    chalk: inertChain,
    c: inertChain,
  };
}

/**
 * A logger that keeps every line it is handed, so the summary and the task
 * messages can both be asserted — a task that says nothing is how "the farmer
 * can't do this" gets reported for a task that works.
 */
function capturingLogger() {
  const lines = [];
  const record = (...parts) => lines.push(parts.filter(Boolean).join(" "));

  return {
    lines,
    log: record,
    info: record,
    warn: record,
    error: record,
    success: record,
    newline: () => {},
    output: record,
    keyValue: (label, value) => lines.push(`${label}: ${value}`),
    chalk: inertChain,
    c: inertChain,
  };
}

/** A Telegram client that records the links it is asked to start. */
function recordingClient() {
  const started = [];
  return {
    started,
    startBotFromLink: async (options) => {
      started.push(options);
    },
  };
}

/** An axios-shaped rejection with an HTTP status. */
function httpError(status) {
  const error = new Error(`Request failed with status code ${status}`);
  error.response = { status, data: {} };
  return error;
}

/**
 * A state shaped like GET /api/state (real fields, taken from the capture that
 * defined this farmer) where every actionable flag starts in the "do nothing"
 * position, so a call that happens anyway is a bug in the gate.
 */
function idleState() {
  return {
    now: 1790570090,
    // Synthetic identity: the original capture's real tgId and username must
    // not live in the repo, fixtures included.
    profile: { tgId: 1000000001, username: "redacted_user" },
    balances: {
      gold: 4450,
      keys: { wooden: 0, iron: 0, golden: 0, diamond: 0, mythic: 0 },
      tickets: 0,
      spins: 0,
      gems: 68,
      slotTokens: 0,
      scratchCards: 1,
    },
    mines: [
      {
        id: 73771,
        mineId: "meadow_old_shaft",
        slot: 0,
        pending: 0,
        yieldPerCycle: 1000,
        progress: 0.004,
        nextIn: 21507,
        full: false,
      },
    ],
    streak: { streak: 1, claimable: false },
    ladder: { step: 1, next: 2, freeReadyAt: 0 },
    wheel: { freeToday: 0, spins: 0 },
    // `opened` is an object keyed by cell index, not a count — the shape
    // copied from the capture. A numeric fixture here is what let a
    // `Number(dig.opened)` bug read as "cell 0" and refuse every cycle.
    dig: { day: 20724, opened: { "0": { kind: "rock" } }, tickets: 0, done: true },
    seen: ["intro"],
    // The chest runs on its own 4h cooldown (`meta.chest.readyAt`), not on dig
    // tickets, so the do-nothing position is a cooldown in the far future.
    meta: { chest: { readyAt: 4102444800 } },
    daily: [{ id: "spin", progress: 0, need: 1, claimed: true }],
    tasks: [{ id: "box1", done: false, openedAt: 1, ready: false }],
  };
}

/** A farmer wired to a recording transport: every POST path is captured. */
function recordingFarmer(state = idleState()) {
  const farmer = new EasyCoinFarmer();
  const calls = [];

  farmer.logger = silentLogger();
  farmer.user_data = state;
  farmer.config = { ...farmer.config, pacing: false };
  farmer.post = async (path, payload = {}) => {
    calls.push({ path, payload });
    return { state: farmer.user_data };
  };

  return { farmer, calls };
}

test("auth carries the tma scheme with the platform and version the app sends", () => {
  const farmer = new EasyCoinFarmer();

  assert.deepStrictEqual(farmer.getAuthHeaders("query_id=AAH&hash=deadbeef"), {
    authorization: "tma query_id=AAH&hash=deadbeef",
    "x-tg-platform": "android",
    "x-tg-version": "9.6",
  });

  // No init data means no auth headers at all: an empty `tma ` header would
  // turn the API's own "empty_init_data" 401 into an unreadable one.
  assert.deepStrictEqual(farmer.getAuthHeaders(), {});
  assert.deepStrictEqual(farmer.getAuthHeaders(undefined), {});
});

test("mines are collected only when a mine actually holds pending gold", async () => {
  const { farmer, calls } = recordingFarmer();
  await farmer.collectMinedGold();
  assert.deepStrictEqual(
    calls.map((c) => c.path),
    [],
    "a mine with pending: 0 must not spend a collect call",
  );

  const rich = recordingFarmer();
  rich.farmer.user_data.mines[0].pending = 1000;
  await rich.farmer.collectMinedGold();
  assert.deepStrictEqual(
    rich.calls.map((c) => c.path),
    ["/mines/collect"],
    "a mine holding pending gold must be collected",
  );
});

test("free actions stay silent while their own flags say they are not ready", async () => {
  const state = idleState();
  state.ladder.freeReadyAt = 1799999999; // still counting down
  state.wheel.freeToday = 0;
  state.streak.claimable = false;
  state.balances.tickets = 0;
  state.balances.slotTokens = 0;

  const { farmer, calls } = recordingFarmer(state);

  await farmer.claimLadder();
  await farmer.spinWheel();
  await farmer.claimBonus();
  await farmer.claimChest();
  await farmer.spinSlots();

  assert.deepStrictEqual(calls, [], "no free action may fire while unready");
});

test("every ready free action is taken", async () => {
  const state = idleState();
  state.ladder.freeReadyAt = 1790570000; // in the past relative to `now`
  state.wheel.freeToday = 1;
  state.streak.claimable = true;
  // Zero dig tickets on purpose: the chest is gated by its own cooldown, and
  // this pins that the two currencies are not the same gate.
  state.balances.tickets = 0;
  state.meta.chest.readyAt = 0;
  state.balances.slotTokens = 5;

  const { farmer, calls } = recordingFarmer(state);

  await farmer.claimLadder();
  await farmer.spinWheel();
  await farmer.claimBonus();
  await farmer.claimChest();
  await farmer.spinSlots();

  assert.deepStrictEqual(
    calls.map((c) => c.path),
    ["/ladder/claim", "/wheel/spin", "/bonus/claim", "/chest/claim", "/slots/spin"],
  );
});

test("dailies and tasks are driven by their per-entry flags, not the whole list", async () => {
  const state = idleState();
  state.daily = [
    { id: "spin", progress: 1, need: 1, claimed: false },
    { id: "invite", progress: 0, need: 3, claimed: false },
    { id: "ads", progress: 5, need: 5, claimed: true },
  ];
  state.tasks = [
    { id: "box1", done: false, openedAt: 1, ready: true },
    { id: "channel", done: false, openedAt: 1, ready: false },
    { id: "streak", done: true, openedAt: 1, ready: true },
  ];

  const { farmer, calls } = recordingFarmer(state);

  await farmer.claimDailyObjectives();
  await farmer.checkTasks();

  assert.deepStrictEqual(
    calls.map((c) => `${c.path} ${JSON.stringify(c.payload)}`),
    [
      '/daily/claim {"id":"spin"}',
      '/tasks/check {"id":"box1"}',
    ],
    "only completed-unclaimed dailies and ready-unfinished tasks may be called",
  );
});

test("an action that fails does not abort the rest of the cycle", async () => {
  const farmer = new EasyCoinFarmer();
  const ran = [];

  farmer.logger = silentLogger();
  farmer.user_data = idleState();
  farmer.login = async () => {
    ran.push("login");
    return farmer.user_data;
  };
  farmer.logUserInfo = async () => {};
  farmer.collectMinedGold = async () => {
    ran.push("collect");
    throw httpError(429);
  };
  farmer.claimLadder = async () => ran.push("ladder");
  farmer.checkTasks = async () => ran.push("tasks");
  farmer.startOwnBot = async () => ran.push("start");

  await assert.doesNotReject(() => farmer.process());

  assert.ok(ran.includes("login"), "login must run");
  assert.ok(
    ran.indexOf("start") > ran.indexOf("login"),
    "START needs the account identity, so it runs after login",
  );
  assert.ok(ran.includes("ladder"), "ladder must still run after a 429 on collect");
  assert.ok(ran.includes("tasks"), "tasks must still run after a 429 on collect");
});

test("a box is paid for with the key it costs, never with GRAM", async () => {
  const state = idleState();
  state.balances.keys.wooden = 2;

  const { farmer, calls } = recordingFarmer(state);
  await farmer.openBoxes();

  assert.deepStrictEqual(
    calls,
    [{ path: "/box/open", payload: { box: "wooden", pay: "key" } }],
    "the key must be named as the payment; omitting `pay` bills GRAM instead",
  );
  assert.ok(
    !calls.some((call) => call.path.startsWith("/shop/")),
    "a held key must never fall through to the GRAM shop",
  );
});

test("an account holding no key never buys a box", async () => {
  const { farmer, calls } = recordingFarmer();
  await farmer.openBoxes();

  assert.deepStrictEqual(calls, [], "no key means no box — not a GRAM purchase");
});

test("dig opens the first cell that is not already dug", async () => {
  const state = idleState();
  state.dig = {
    day: 20724,
    opened: { "0": { kind: "rock" }, "1": { kind: "rock" } },
    tickets: 3,
    done: false,
  };

  const { farmer, calls } = recordingFarmer(state);
  await farmer.digCells();

  assert.deepStrictEqual(
    calls,
    [{ path: "/dig/open", payload: { cell: 2 } }],
    "cells 0 and 1 are already dug, so the next cell is 2",
  );
});

test("dig is gated by its own ticket counter, not the chest one", async () => {
  const state = idleState();
  state.balances.tickets = 3; // chest tickets — a different currency
  state.dig = { day: 20724, opened: {}, tickets: 0, done: false };

  const { farmer, calls } = recordingFarmer(state);
  await farmer.digCells();

  assert.deepStrictEqual(
    calls,
    [],
    "`dig.tickets` is the dig's own daily allowance",
  );
});

test("dig is skipped once the board is finished", async () => {
  const state = idleState();
  state.balances.tickets = 3;
  state.dig = {
    day: 20724,
    opened: { "0": { kind: "rock" } },
    tickets: 5,
    done: true,
  };

  const { farmer, calls } = recordingFarmer(state);
  await farmer.digCells();

  assert.deepStrictEqual(calls, [], "a finished board must not be dug again");
});

test("a dig state without a ticket field is attempted, not assumed empty", async () => {
  const state = idleState();
  // Schema drift: the field is gone. Spending one refused call beats never
  // digging again, which is how the numeric-`opened` bug stayed invisible.
  state.dig = { day: 20724, opened: {}, done: false };

  const { farmer, calls } = recordingFarmer(state);
  await farmer.digCells();

  assert.deepStrictEqual(calls, [{ path: "/dig/open", payload: { cell: 0 } }]);
});

test("the summary reports dig progress and slot spins", async () => {
  const state = idleState();
  state.dig = {
    day: 20724,
    opened: { "0": { kind: "rock" }, "12": { kind: "gold" } },
    tickets: 1,
    done: false,
  };
  state.balances.slotTokens = 4;
  state.balances.spins = 0;

  const farmer = new EasyCoinFarmer();
  farmer.logger = capturingLogger();
  farmer.user_data = state;
  farmer.logCurrentUser = () => {};

  await farmer.logUserInfo();

  const summary = farmer.logger.lines.join("\n");
  assert.match(summary, /Dig: 2 cells dug · 1 ticket/, summary);
  assert.match(summary, /Slots: 4 tokens · 0 spins/, summary);
});

test("mines acquired from boxes are placed into the first free slots", async () => {
  const state = idleState();
  // The board straight out of the EASY2 capture: slot 0 taken, and the two
  // mines the box opens had just minted with `slot: null`.
  state.mines = [
    { id: 74054, mineId: "meadow_old_shaft", slot: 0, pending: 0 },
    { id: 74116, mineId: "meadow_old_shaft", slot: null, pending: 0 },
    { id: 74117, mineId: "meadow_windmill", slot: null, pending: 0 },
  ];

  const { farmer, calls } = recordingFarmer(state);
  await farmer.placeUnassignedMines();

  assert.deepStrictEqual(
    calls,
    [
      { path: "/mines/slot", payload: { id: 74116, slot: 1 } },
      { path: "/mines/slot", payload: { id: 74117, slot: 2 } },
    ],
    "the capture places them in slots 1 and 2, in that order",
  );
});

test("a full board is not asked for a slot it does not own", async () => {
  const state = idleState();
  // Five slots exist (slots 0-4), so a sixth mine has nowhere to go.
  state.mines = [
    { id: 1, slot: 0 },
    { id: 2, slot: 1 },
    { id: 3, slot: 2 },
    { id: 4, slot: 3 },
    { id: 5, slot: 4 },
    { id: 6, slot: null },
  ];

  const farmer = new EasyCoinFarmer();
  farmer.logger = capturingLogger();
  farmer.user_data = state;

  const calls = [];
  farmer.post = async (path, payload = {}) => {
    calls.push({ path, payload });
    return {};
  };

  await farmer.placeUnassignedMines();

  assert.deepStrictEqual(
    calls,
    [],
    "a slot 5 call can only fail, and it would fail every cycle",
  );
  assert.match(farmer.logger.lines.join("\n"), /slots are full/i);
});

test("a mine whose slot is not a real index is still unplaced", async () => {
  const state = idleState();
  state.mines = [
    { id: 1, slot: 0 },
    { id: 2, slot: -1 },
  ];

  const { farmer, calls } = recordingFarmer(state);
  await farmer.placeUnassignedMines();

  assert.deepStrictEqual(
    calls,
    [{ path: "/mines/slot", payload: { id: 2, slot: 1 } }],
    "only a non-negative integer slot counts as placed",
  );
});

test("a board with every mine slotted says so instead of going quiet", async () => {
  const farmer = new EasyCoinFarmer();
  farmer.logger = capturingLogger();
  farmer.user_data = idleState(); // one mine, already in slot 0
  farmer.post = async () => {
    throw new Error("no call may be made when there is nothing to place");
  };

  await farmer.placeUnassignedMines();

  assert.match(
    farmer.logger.lines.join("\n"),
    /already in slots/i,
    "silence is what made a working task look like a missing one",
  );
});

test("START is pressed through the Telegram client, over the bot's own link", async () => {
  EasyCoinFarmer.startedBots.clear();

  const farmer = new EasyCoinFarmer();
  farmer.logger = capturingLogger();
  farmer.user_data = idleState();
  farmer.client = recordingClient();

  await farmer.startOwnBot();

  assert.deepStrictEqual(
    farmer.client.started,
    [
      {
        link: "https://t.me/EasyCoinFarBot/app?startapp=g31m4894",
        startOptions: { shouldWaitForReply: false },
      },
    ],
    "the link carries startParam, which is what the chat's START button sends",
  );
});

test("no Telegram client means no START, and no crash", async () => {
  EasyCoinFarmer.startedBots.clear();

  const farmer = new EasyCoinFarmer();
  farmer.logger = capturingLogger();
  farmer.user_data = idleState();

  await assert.doesNotReject(() => farmer.startOwnBot());
  assert.match(farmer.logger.lines.join("\n"), /No Telegram client/i);
});

test("the bot is started once, not on every cycle", async () => {
  EasyCoinFarmer.startedBots.clear();

  const farmer = new EasyCoinFarmer();
  farmer.logger = capturingLogger();
  farmer.user_data = idleState();
  farmer.client = recordingClient();

  await farmer.startOwnBot();
  await farmer.startOwnBot();
  await farmer.startOwnBot();

  assert.strictEqual(
    farmer.client.started.length,
    1,
    "a fleet on a */10 schedule must not re-invoke StartBot every cycle",
  );
});

test("START always uses the operator's link, never the account's own", async () => {
  EasyCoinFarmer.startedBots.clear();

  const state = idleState();
  // A real account carries its own referral code in its state. Wiring START to
  // that would hand every referred signup to the account instead of to you.
  state.profile = {
    ...state.profile,
    referralLink: "https://t.me/EasyCoinFarBot/app?startapp=g3mhed5c",
  };

  const farmer = new EasyCoinFarmer();
  farmer.logger = capturingLogger();
  farmer.user_data = state;
  farmer.config = { ...farmer.config, pacing: false };
  farmer.client = recordingClient();

  await farmer.startOwnBot();

  assert.strictEqual(
    farmer.client.started[0]?.link,
    "https://t.me/EasyCoinFarBot/app?startapp=g31m4894",
    "startapp=g31m4894 is the operator's code and must survive every edit",
  );
});

test("the intro is acknowledged once, and only while it is unseen", async () => {
  const unseen = idleState();
  unseen.seen = [];

  const first = recordingFarmer(unseen);
  await first.farmer.acknowledgeSeen();
  assert.deepStrictEqual(first.calls, [
    { path: "/seen", payload: { key: "intro" } },
  ]);

  const seen = recordingFarmer(); // idleState already lists "intro"
  await seen.farmer.acknowledgeSeen();
  assert.deepStrictEqual(seen.calls, [], "a seen intro is not acknowledged twice");
});

test("missions are claimed only once their target is met", async () => {
  const state = idleState();
  state.meta = {
    ...state.meta,
    missions: {
      missions: [
        { id: "wheel", target: 1, progress: 1, gems: 15, claimed: false },
        { id: "dig", target: 5, progress: 2, gems: 15, claimed: false },
        { id: "collect", target: 3, progress: 3, gems: 15, claimed: true },
      ],
    },
  };

  const { farmer, calls } = recordingFarmer(state);
  await farmer.claimMissions();

  assert.deepStrictEqual(
    calls,
    [{ path: "/missions/claim", payload: { id: "wheel" } }],
    "only a met, unclaimed mission may be claimed",
  );
});

test("scratch cards are played until the balance stops moving", async () => {
  const state = idleState();
  state.balances.scratchCards = 2;

  const { farmer, calls } = recordingFarmer(state);
  await farmer.playScratchCards();

  assert.deepStrictEqual(
    calls.map((call) => call.path),
    ["/scratch/play"],
    "the loop must stop when the server does not spend a card",
  );
});

test("the shop daily is nudged, and only the shop one", async () => {
  const state = idleState();
  state.daily = [
    { id: "shop", progress: 0, need: 1, claimed: false },
    { id: "share", progress: 0, need: 1, claimed: false },
  ];

  const { farmer, calls } = recordingFarmer(state);
  await farmer.bumpDailyObjectives();

  assert.deepStrictEqual(
    calls,
    [{ path: "/daily/bump", payload: { id: "shop" } }],
    "`share` bumping was never captured, so it is not attempted",
  );
});

test("the channel task is opened, and only while it is still openable", async () => {
  const state = idleState();
  state.tasks = [{ id: "channel", done: false, ready: false, openedAt: 0 }];

  const { farmer, calls } = recordingFarmer(state);
  await farmer.openTasks();

  assert.deepStrictEqual(calls, [
    { path: "/tasks/open", payload: { id: "channel" } },
  ]);

  const opened = idleState();
  opened.tasks = [{ id: "channel", done: false, ready: false, openedAt: 1 }];
  const second = recordingFarmer(opened);
  await second.farmer.openTasks();
  assert.deepStrictEqual(second.calls, [], "an already-opened timer is not restarted");
});

test("tasks we cannot satisfy are never checked or opened", async () => {
  const state = idleState();
  state.tasks = [
    { id: "deposit1", done: false, ready: true, openedAt: 1 },
    { id: "wallet", done: false, ready: true, openedAt: 1 },
    { id: "league_gold", done: false, ready: true, openedAt: 1 },
    { id: "invite1", done: false, ready: false, openedAt: 0 },
  ];

  const { farmer, calls } = recordingFarmer(state);
  await farmer.checkTasks();
  await farmer.openTasks();

  assert.deepStrictEqual(
    calls,
    [],
    "a task needing a deposit, a wallet, a league place or invites is not ours to satisfy",
  );
});

test("the chest is gated on its own cooldown, not on dig tickets", async () => {
  const ready = idleState();
  ready.balances.tickets = 0;
  ready.meta.chest.readyAt = 0;

  const first = recordingFarmer(ready);
  await first.farmer.claimChest();
  assert.deepStrictEqual(
    first.calls,
    [{ path: "/chest/claim", payload: {} }],
    "a ready chest is claimable with no dig tickets at all",
  );

  const cooling = recordingFarmer(); // idleState has a far-future readyAt
  await cooling.farmer.claimChest();
  assert.deepStrictEqual(cooling.calls, [], "a chest on cooldown stays shut");
});

test("a fully dug board is not asked for a cell outside the grid", async () => {
  const state = idleState();
  const opened = {};
  for (let cell = 0; cell < 25; cell++) opened[cell] = { kind: "rock" };
  state.dig = { day: 1, opened, tickets: 3, done: false };

  const { farmer, calls } = recordingFarmer(state);
  await farmer.digCells();

  assert.deepStrictEqual(
    calls,
    [],
    "the grid is cells 0-24, so a 26th request has nowhere to land",
  );
});

test("an action can be switched off through config", async () => {
  const state = idleState();
  state.balances.scratchCards = 1;

  const { farmer, calls } = recordingFarmer(state);
  farmer.config = { ...farmer.config, scratch: false };
  await farmer.playScratchCards();

  assert.deepStrictEqual(calls, [], "a disabled action must stay silent");
});

test("dry run plans the cycle but never acts", async () => {
  EasyCoinFarmer.startedBots.clear();

  const state = idleState();
  state.mines = [{ id: 1, slot: 0, pending: 500 }];
  state.streak.claimable = true;

  const farmer = new EasyCoinFarmer();
  farmer.logger = capturingLogger();
  farmer.user_data = state;
  farmer.config = { ...farmer.config, pacing: false, dryRun: true };

  const calls = [];
  farmer.get = async () => state;
  farmer.post = async (path, payload = {}) => {
    calls.push({ path, payload });
    throw new Error("a dry run must not POST anything");
  };
  farmer.client = recordingClient();

  await assert.doesNotReject(() => farmer.process());

  assert.deepStrictEqual(
    calls,
    [],
    "a dry run reads state and plans, but never mutates the account",
  );
  assert.deepStrictEqual(
    farmer.client.started,
    [],
    "START is a Telegram-side mutation, so a dry run must not press it either",
  );

  const log = farmer.logger.lines.join("\n");
  assert.match(log, /Dry run/, log);
  assert.match(log, /Would run: Collect/, log);
  assert.match(log, /Would run: Daily Bonus/, log);
  assert.match(log, /Would run: Start Bot/, log);
  assert.match(log, /Next run/, log);
});

test("dry run still reads the real state it is planning from", async () => {
  EasyCoinFarmer.startedBots.clear();

  const state = idleState();
  state.balances.gold = 12345;

  const farmer = new EasyCoinFarmer();
  farmer.logger = capturingLogger();
  farmer.config = { ...farmer.config, pacing: false, dryRun: true };

  farmer.get = async () => state;
  await farmer.process();

  const log = farmer.logger.lines.join("\n");
  assert.match(log, /Gold: 12345/, "the plan is built from the live state");
});

test("next run is the nearest gate, ahead of now, plus jitter", () => {
  const farmer = new EasyCoinFarmer();
  farmer.user_data = idleState();

  // All three gates sit inside the one-hour cap, so the nearest one wins: the
  // chest gate at 2010s beats the ladder (2150s) and the mine (2340s). UTC
  // midnight is always further than a few hours except in the last minute of
  // the day, which this fixture avoids.
  const now = Date.UTC(2026, 8, 28, 12, 0, 0);
  farmer.user_data.mines = [
    { id: 1, slot: 0, pending: 0, nextIn: 2340 },
  ];
  farmer.user_data.meta = { chest: { readyAt: now / 1000 + 2010 } };
  farmer.user_data.ladder = { freeReadyAt: now / 1000 + 2150 };

  const nextRunAt = farmer.computeNextRunAt(now);
  const seconds = (nextRunAt - now) / 1000;

  assert.ok(
    seconds >= 2010 && seconds <= 2010 + 120,
    `expected the chest gate (2010s) plus 30-120s of jitter, got ${seconds}s`,
  );
});

test("next run never sleeps past the one-hour cap", () => {
  const farmer = new EasyCoinFarmer();
  farmer.user_data = idleState();

  const now = Date.UTC(2026, 8, 28, 12, 0, 0);
  farmer.user_data.mines = [{ id: 1, slot: 0, pending: 0, nextIn: 86400 }];
  farmer.user_data.meta = { chest: { readyAt: now / 1000 + 90000 } };
  farmer.user_data.ladder = { freeReadyAt: now / 1000 + 7200 };

  const seconds = (farmer.computeNextRunAt(now) - now) / 1000;

  assert.ok(
    seconds >= 3600 && seconds <= 3600 + 120,
    `expected the safety cap (3600s) plus 30-120s of jitter, got ${seconds}s`,
  );
});

test("next run ignores gates already in the past", () => {
  const farmer = new EasyCoinFarmer();
  farmer.user_data = idleState();

  const now = Date.UTC(2026, 8, 28, 12, 0, 0);
  farmer.user_data.mines = [{ id: 1, slot: 0, pending: 0, nextIn: 0 }];
  farmer.user_data.meta = { chest: { readyAt: now / 1000 - 500 } };
  farmer.user_data.ladder = { freeReadyAt: now / 1000 - 500 };

  const seconds = (farmer.computeNextRunAt(now) - now) / 1000;

  assert.ok(seconds > 0, `a past gate must not pull the run into the past`);
});

test("calls inside an action loop are paced inside the configured window", async () => {
  const state = idleState();
  state.balances.slotTokens = 5;

  const farmer = new EasyCoinFarmer();
  farmer.logger = silentLogger();
  farmer.user_data = state;
  farmer.config = {
    ...farmer.config,
    minDelayMs: 50,
    maxDelayMs: 80,
  };

  const betweenCallsMs = [];
  let previousAt;
  let tokens = 5;
  farmer.post = async (path, payload = {}) => {
    const now = Date.now();
    if (previousAt !== undefined) betweenCallsMs.push(now - previousAt);
    previousAt = now;
    // Deduct like the server would, or the spend-guard in the loop stops it
    // after one spin and there is nothing to measure.
    tokens -= 1;
    farmer.user_data = {
      ...farmer.user_data,
      balances: { ...farmer.user_data.balances, slotTokens: tokens },
    };
    return { state: farmer.user_data };
  };

  await farmer.spinSlots();

  assert.ok(
    betweenCallsMs.length >= 3,
    "five tokens mean at least four gaps to measure",
  );
  for (const gap of betweenCallsMs) {
    assert.ok(
      gap >= 50 && gap <= 90,
      `expected every gap inside the 50-80ms window, got ${gap}ms`,
    );
  }
});

test("pacing can be switched off entirely", async () => {
  const state = idleState();
  state.balances.slotTokens = 3;

  const farmer = new EasyCoinFarmer();
  farmer.logger = silentLogger();
  farmer.user_data = state;
  farmer.config = { ...farmer.config, pacing: false };

  const betweenCallsMs = [];
  let previousAt;
  farmer.post = async (path, payload = {}) => {
    const now = Date.now();
    if (previousAt !== undefined) betweenCallsMs.push(now - previousAt);
    previousAt = now;
    return { state: farmer.user_data };
  };

  await farmer.spinSlots();

  for (const gap of betweenCallsMs) {
    assert.ok(gap < 20, `pacing is off, yet a gap measured ${gap}ms`);
  }
});

test("claiming reports the balance delta it produced", async () => {
  const state = idleState();
  state.balances.gold = 4450;
  state.streak.claimable = true;

  const farmer = new EasyCoinFarmer();
  farmer.logger = capturingLogger();
  farmer.user_data = state;
  farmer.config = { ...farmer.config, pacing: false };

  farmer.post = async (path, payload = {}) => ({
    day: 2,
    reward: { gold: 100, xp: 25 },
    state: {
      ...farmer.user_data,
      balances: { ...farmer.user_data.balances, gold: 4550 },
      meta: { level: { xp: 25 } },
    },
  });

  await farmer.claimBonus();

  const log = farmer.logger.lines.join("\n");
  assert.match(log, /\(\+100 gold, \+25 xp\)/, log);
});

test("an action that changes nothing reports no delta", async () => {
  const state = idleState();
  state.streak.claimable = false;

  const farmer = new EasyCoinFarmer();
  farmer.logger = capturingLogger();
  farmer.user_data = state;
  farmer.config = { ...farmer.config, pacing: false };

  await farmer.claimBonus();

  assert.ok(
    !/\(\+/.test(farmer.logger.lines.join("\n")),
    "no action ran, so no delta may be printed",
  );
});

test("key spending shows up in the delta as negative", async () => {
  const state = idleState();
  state.balances.keys.wooden = 2;

  const farmer = new EasyCoinFarmer();
  farmer.logger = capturingLogger();
  farmer.user_data = state;
  farmer.config = { ...farmer.config, pacing: false };

  farmer.post = async (path, payload = {}) => {
    const keys = { ...farmer.user_data.balances.keys, wooden: 1 };
    return {
      box: "wooden",
      mine: { id: 99, mineId: "meadow_windmill", slot: null },
      rarity: "common",
      state: {
        ...farmer.user_data,
        balances: { ...farmer.user_data.balances, keys },
      },
    };
  };

  await farmer.openBoxes();

  assert.match(
    farmer.logger.lines.join("\n"),
    /\(-1 wooden key\)/,
    "spending a key is a negative delta",
  );
});
