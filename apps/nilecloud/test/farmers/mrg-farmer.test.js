import * as assert from "node:assert";
import { test } from "node:test";

import MRGFarmer from "@nile/shared/farmers/MrgFarmer.js";

const WALLET = "UQBpJM8mSdqrdDjYGDoVMZPxeKv7gPCDlxRwNmIP_OZhlEoM";

/** A logger that swallows the farmer's output. */
function silentLogger() {
  const chain = new Proxy(function () {}, {
    get: () => chain,
    apply: (_self, _this, args) => args[0] ?? "",
  });

  return {
    log: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    success: () => {},
    newline: () => {},
    keyValue: () => {},
    output: () => {},
    chalk: chain,
    c: chain,
  };
}

/** The account the fake API answers with. */
function account(overrides = {}) {
  return {
    id: 2539,
    referralCode: "T90OGL9E",
    inAppBalance: 1000,
    unclaimedMiningBalance: 0,
    totalMinedLifetime: 0,
    tonWalletAddress: WALLET,
    tonWalletBalance: 0,
    checkinLastDay: null,
    checkinStreak: 0,
    isVerified: true,
    isVerificationRequired: false,
    ...overrides,
  };
}

/**
 * A farmer wired to a fake API, with the heavy steps stubbed out so the test
 * only sees the order the run goes in.
 */
function makeFarmer({ user = account(), tasks = [] } = {}) {
  const logger = silentLogger();
  const calls = [];
  const delays = [];
  const farmer = new MRGFarmer();

  farmer.logger = logger;
  farmer.utils = {
    delayForSeconds: async (seconds) => {
      delays.push(seconds);
    },
    delay: async () => {},
  };
  farmer.setTelegramWebApp({
    initData: "query_id=AAEQM0VWAwAAABAzRVYMG2ra",
    initDataUnsafe: { user: { id: 7889826576, username: "paulponi" } },
  });
  farmer.storage = {
    get: async () => null,
    set: async () => {},
  };

  farmer.api = {
    interceptors: { request: { use: () => 1, eject: () => {} } },
    post: async (url, body) => {
      calls.push({ url, body });

      if (url.endsWith("/auth/verify")) {
        return {
          data: { success: true, verified: true, user, tasks, completedTaskIds: [] },
        };
      }

      if (url.endsWith("/user/me")) {
        return { data: { success: true, user, tasks, completedTaskIds: [] } };
      }

      if (url.endsWith("/user/daily-checkin")) {
        return { data: { success: true, reward: 15, user } };
      }

      if (url.endsWith("/user/claim-task")) {
        return { data: { success: true, reward: 250, user } };
      }

      return { data: { success: true } };
    },
  };

  farmer.account_data = { user, tasks, completedTaskIds: [] };

  /* The steps the order test is not about. */
  farmer.updatePresence = async () => {};
  farmer.logAccountInfo = async () => {};
  farmer.unlockAffordableLevel = async () => {};
  farmer.claimSquadRewards = async () => {};
  farmer.withdraw = async () => {};
  farmer.storeAutoSnapshot = async () => {};
  farmer.ensureHumanCheck = async () => "test-turnstile-token";

  /* Record the order the run goes in. */
  const order = [];
  farmer.executeTask = async (name, callback) => {
    order.push(name);
    return callback();
  };

  return { farmer, calls, delays, order };
}

test("the run does the tasks and the check-in before the human check and the mining", async () => {
  const { farmer, order } = makeFarmer();

  await farmer.process();

  assert.deepEqual(order, [
    "Tasks",
    "Check-In",
    "Level",
    "Squad",
    "Human Check",
    "Mining",
    "Withdraw",
  ]);

  const tasksIdx = order.indexOf("Tasks");
  const checkInIdx = order.indexOf("Check-In");
  const humanCheck = order.indexOf("Human Check");
  const mining = order.indexOf("Mining");

  assert.ok(tasksIdx < checkInIdx, "the tasks have to come before the check-in");
  assert.ok(checkInIdx < humanCheck, "the check-in has to come before the human check");
  assert.ok(
    humanCheck < mining,
    "the human check has to come before the mining it guards",
  );
});

test("the tasks are asked for before the check-in and the mining", async () => {
  const { farmer, calls } = makeFarmer({
    tasks: [
      {
        taskId: 7,
        title: "Subscribe to the channel",
        reward: 250,
        url: "https://t.me/lootvault_channel",
        verificationType: "tg_channel",
        taskType: "one_time",
      },
    ],
  });
  farmer.validateTelegramTask = () => true;
  farmer.tryToJoinTelegramLink = async () => true;

  await farmer.process();

  const checkInAt = calls.findIndex((call) =>
    call.url.endsWith("/user/daily-checkin"),
  );
  const claimTaskAt = calls.findIndex((call) =>
    call.url.endsWith("/user/claim-task"),
  );

  assert.ok(checkInAt > -1, "the check-in was never asked for");
  assert.ok(claimTaskAt > -1, "the task claim was never asked for");
  assert.ok(
    claimTaskAt < checkInAt,
    `the tasks (${claimTaskAt}) must come before the check-in (${checkInAt})`,
  );
});

test("a task is opened, left open, and claimed", async () => {
  const { farmer, calls, delays } = makeFarmer({
    tasks: [
      {
        taskId: 7,
        title: "Subscribe to the channel",
        reward: 250,
        url: "https://t.me/lootvault_channel",
        verificationType: "tg_channel",
        taskType: "one_time",
      },
    ],
  });

  farmer.validateTelegramTask = () => true;
  farmer.tryToJoinTelegramLink = async () => true;

  await farmer.completeTasks();

  const claim = calls.find((call) => call.url.endsWith("/user/claim-task"));
  assert.ok(claim, "the task was never claimed");
  assert.deepEqual(claim.body.taskId, 7);

  /* The task is left open for the dwell before the claim lands. */
  assert.ok(
    delays.includes(15),
    `the task was not left open — waited ${delays.join(", ")}`,
  );
});

test("the run stops between one task and the next", async () => {
  const { farmer, delays } = makeFarmer({
    tasks: [
      {
        taskId: 1,
        title: "One",
        reward: 250,
        url: "https://t.me/one",
        verificationType: "tg_channel",
        taskType: "one_time",
      },
      {
        taskId: 2,
        title: "Two",
        reward: 250,
        url: "https://t.me/two",
        verificationType: "tg_channel",
        taskType: "one_time",
      },
    ],
  });

  farmer.validateTelegramTask = () => true;
  farmer.tryToJoinTelegramLink = async () => true;

  await farmer.completeTasks();

  /* Two tasks: a dwell for each, and a stop after each. */
  const stops = delays.filter((seconds) => seconds === 5);
  assert.equal(stops.length, 2, `expected a stop after each task, waited ${delays.join(", ")}`);
});

test("a check-in that is already done is left alone", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const { farmer, calls } = makeFarmer({ user: account({ checkinLastDay: today }) });

  await farmer.checkInDaily();

  assert.equal(
    calls.filter((call) => call.url.endsWith("/user/daily-checkin")).length,
    0,
    "the account checked in twice",
  );
});
