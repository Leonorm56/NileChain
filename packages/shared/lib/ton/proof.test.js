import assert from "node:assert/strict";
import { test } from "node:test";

import { keyPairFromSeed, sha256, signVerify } from "@ton/crypto";

import { buildTonProof } from "./proof.js";

/** A throwaway key pair, so the test signs and checks with the same key. */
function makeKeyPair() {
  return keyPairFromSeed(Buffer.alloc(32, 7));
}

test("the proof carries what the drop checks", async () => {
  const keyPair = makeKeyPair();
  const wallet = { stateInit: { toBounce: () => Buffer.from("cell-bytes") } };

  const proof = await buildTonProof({
    wallet,
    secretKey: keyPair.secretKey,
    domain: "app.mrgtoken.xyz",
    payload: "the-payload",
  });

  assert.equal(proof.domain, "app.mrgtoken.xyz");
  assert.equal(proof.payload, "the-payload");
  assert.equal(proof.state_init, Buffer.from("cell-bytes").toString("base64"));
  assert.equal(typeof proof.timestamp, "number");
  assert.equal(typeof proof.signature, "string");
});

test("the signature covers the proof", async () => {
  const keyPair = makeKeyPair();
  const wallet = { stateInit: { toBounce: () => Buffer.from("cell-bytes") } };

  const proof = await buildTonProof({
    wallet,
    secretKey: keyPair.secretKey,
    domain: "app.mrgtoken.xyz",
    payload: "the-payload",
  });

  const { signature, ...unsigned } = proof;
  const hash = sha256(Buffer.from(JSON.stringify(unsigned), "utf8"));

  assert.ok(
    signVerify(hash, Buffer.from(signature, "base64"), keyPair.publicKey),
    "the signature does not cover the proof",
  );
});

test("a proof with nothing to sign is refused", async () => {
  const keyPair = makeKeyPair();

  await assert.rejects(
    () =>
      buildTonProof({
        wallet: null,
        secretKey: keyPair.secretKey,
        domain: "app.mrgtoken.xyz",
        payload: "p",
      }),
    /No wallet/,
  );

  await assert.rejects(
    () =>
      buildTonProof({
        wallet: { stateInit: { toBounce: () => Buffer.from("c") } },
        secretKey: keyPair.secretKey,
        domain: "app.mrgtoken.xyz",
        payload: "",
      }),
    /No payload/,
  );
});
