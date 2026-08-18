import { describe, expect, it } from 'vitest';
import { getRatingTier } from './ReviewSection';

describe('rating tiers', () => {
    it('uses the requested marker boundaries', () => {
        expect(getRatingTier(2).label).toBe('Skip It');
        expect(getRatingTier(3).label).toBe('Meh');
        expect(getRatingTier(4).label).toBe('Meh');
        expect(getRatingTier(5).label).toBe('Decent');
        expect(getRatingTier(7).label).toBe('Decent');
        expect(getRatingTier(8).label).toBe('Must Watch');
        expect(getRatingTier(9).label).toBe('Must Watch');
        expect(getRatingTier(10).label).toBe('Masterpiece');
    });
});
