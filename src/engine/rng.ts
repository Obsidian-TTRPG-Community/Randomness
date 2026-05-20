/**
 * Seedable pseudo-random number generator.
 *
 * Uses Mulberry32 — a simple, fast, well-distributed 32-bit PRNG. Suitable
 * for non-cryptographic randomness in a TTRPG context.
 *
 * The seed is mutable: each call to nextU32 advances internal state.
 * Construct with no argument to use a time-based seed; pass a number to make
 * results reproducible (essential for tests).
 */

export class RNG {
    private state: number;

    constructor(seed?: number) {
        this.state = seed !== undefined ? (seed >>> 0) : (Date.now() >>> 0);
        // Avoid zero state (would produce zeros forever)
        if (this.state === 0) this.state = 1;
    }

    /** Next unsigned 32-bit integer. */
    nextU32(): number {
        // Mulberry32
        this.state = (this.state + 0x6D2B79F5) >>> 0;
        let t = this.state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0);
    }

    /** Float in [0, 1). */
    next(): number {
        return this.nextU32() / 0x100000000;
    }

    /** Integer in [min, max] inclusive. */
    intInclusive(min: number, max: number): number {
        if (min > max) [min, max] = [max, min];
        return min + Math.floor(this.next() * (max - min + 1));
    }

    /** Roll a single die of n sides — returns [1, n]. */
    rollDie(sides: number): number {
        if (sides <= 0) return 0;
        return this.intInclusive(1, sides);
    }

    /** Roll `count` dice of `sides` and sum. */
    rollDice(count: number, sides: number): number {
        let sum = 0;
        for (let i = 0; i < count; i++) sum += this.rollDie(sides);
        return sum;
    }

    /** Pick a random index from an array. */
    pickIndex(length: number): number {
        return this.intInclusive(0, length - 1);
    }
}
