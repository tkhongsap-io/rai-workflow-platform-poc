// W5-01 (W5 plan section 3): the canonical scoring inputs and their SHA-256, recorded with each proposal so a
// reproduction can be checked. The canonical form holds, for each rubric question in ascending ID order, the answer
// value, the evidence slot and that slot's state; never attribution, question text or labels. SHA-256 is computed
// here in plain TypeScript (FIPS 180-4) so the server and the browser hash alike, synchronously, with no Node or DOM
// import (module-graph.test.ts; node:crypto cross-check in inputs.test.ts).

import type { RiskRubricBody } from '../schemas/cases.js';
import type { EvidenceSlotStates, RiskAnswerValues } from './types.js';

/** The canonical JSON text the inputs hash covers. Answers to questions the rubric does not have are excluded. */
export function canonicalInputs(
  rubric: RiskRubricBody,
  answers: RiskAnswerValues,
  slotStates: EvidenceSlotStates,
): string {
  const questions = rubric.questions
    .map((q) => q.questionId)
    .sort()
    .map((questionId) => {
      const question = rubric.questions.find((q) => q.questionId === questionId)!;
      const value = Object.hasOwn(answers, questionId) ? (answers[questionId] ?? null) : null;
      const slot = question.evidenceSlot ?? null;
      const state = slot === null ? null : (slotStates[slot] ?? null);
      return [questionId, value, slot, state];
    });
  return JSON.stringify({ questions });
}

/** Lowercase hex SHA-256 of `canonicalInputs(rubric, answers, slotStates)`. */
export function inputsHash(
  rubric: RiskRubricBody,
  answers: RiskAnswerValues,
  slotStates: EvidenceSlotStates,
): string {
  return sha256Hex(canonicalInputs(rubric, answers, slotStates));
}

// ---- SHA-256 (FIPS 180-4) over the UTF-8 encoding of a string ------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

function utf8(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    let cp = char.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd; // a lone surrogate encodes as U+FFFD, as UTF-8 encoders do
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
  }
  return bytes;
}

/** Lowercase hex SHA-256 of the UTF-8 encoding of `text`. */
export function sha256Hex(text: string): string {
  const message = utf8(text);
  const bitLength = message.length * 8;
  message.push(0x80);
  while (message.length % 64 !== 56) message.push(0);
  const high = Math.floor(bitLength / 2 ** 32);
  for (const word of [high, bitLength >>> 0])
    message.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < message.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      w[i] = (message[j]! << 24) | (message[j + 1]! << 16) | (message[j + 2]! << 8) | message[j + 3]!;
    }
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = w[i - 16]! + s0 + w[i - 7]! + s1;
    }
    let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];
    for (let i = 0; i < 64; i += 1) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = h[0]! + a;
    h[1] = h[1]! + b;
    h[2] = h[2]! + c;
    h[3] = h[3]! + d;
    h[4] = h[4]! + e;
    h[5] = h[5]! + f;
    h[6] = h[6]! + g;
    h[7] = h[7]! + hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}
