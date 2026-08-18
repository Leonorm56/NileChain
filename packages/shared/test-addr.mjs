import { Address, beginCell, external, storeMessage, SendMode, internal } from "@ton/core";
import { WalletContractV4 } from "@ton/ton";
import { mnemonicNew, mnemonicToPrivateKey } from "@ton/crypto";

const mn = await mnemonicNew(24);
const kp = await mnemonicToPrivateKey(mn);
const w = WalletContractV4.create({ workchain: 0, publicKey: kp.publicKey });

const bounceable = w.address.toString({ bounceable: true }); // EQ...
const nonBounce = w.address.toString({ bounceable: false }); // UQ...
console.log("bounceable :", bounceable.slice(0, 2) + "...", "->", bounceable.slice(0, 6));
console.log("non-bounce :", nonBounce.slice(0, 2) + "...", "->", nonBounce.slice(0, 6));

// 1) parse normalizes both to the same internal representation
const a1 = Address.parse(bounceable);
const a2 = Address.parse(nonBounce);
console.log("parse equal:", a1.equals(a2), "| same raw:", a1.toRawString() === a2.toRawString());
console.log("raw:", a1.toRawString());

// 2) build identical signed transfer to EQ vs UQ recipient
function build(to) {
  const transfer = w.createTransfer({
    seqno: 0,
    sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    secretKey: kp.secretKey,
    messages: [internal({ to: Address.parse(to), value: 1000000000n, bounce: true, body: beginCell().storeUint(0, 32).endCell() })],
  });
  const ext = external({ to: w.address, init: w.init, body: transfer });
  return beginCell().store(storeMessage(ext)).endCell();
}
const h1 = build(bounceable).hash().toString("hex");
const h2 = build(nonBounce).hash().toString("hex");
console.log("TON transfer hash EQ :", h1.slice(0, 16));
console.log("TON transfer hash UQ :", h2.slice(0, 16));
console.log("TON transfer identical:", h1 === h2);

// 3) jetton body: recipient owner stored as parsed Address in both encodings
function jettonBody(to) {
  return beginCell()
    .storeUint(0xf8a7ea5, 32)
    .storeUint(0, 64)
    .storeCoins(1000000000n)
    .storeAddress(Address.parse(to))
    .storeAddress(Address.parse(w.address.toString()))
    .storeBit(0)
    .storeCoins(10000000n)
    .storeBit(0)
    .endCell();
}
console.log("jetton body equal:", jettonBody(bounceable).hash().toString("hex") === jettonBody(nonBounce).hash().toString("hex"));

// 4) background-style validation accepts both
function validate(to) { try { Address.parse(to); return true; } catch { return false; } }
console.log("validate EQ:", validate(bounceable), "| validate UQ:", validate(nonBounce));
try { Address.parse("UQ-not-an-address"); console.log("garbage: FAILED"); } catch (e) { console.log("garbage rejected:", e.message); }
