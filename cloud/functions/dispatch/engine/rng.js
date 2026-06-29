"use strict";
// Deterministic, seedable PRNG so shuffles are reproducible from a stored seed.
// (mulberry32 over a string-hashed seed.)
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeRng = makeRng;
exports.shuffle = shuffle;
function hashSeed(seed) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
        h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
}
function makeRng(seed) {
    let a = hashSeed(seed);
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** Fisher–Yates shuffle using a seeded rng. Returns a new array. */
function shuffle(arr, rng) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}
