import { describe, it, expect } from 'vitest';
import { resolveSource, similarity } from './SourceResolver';
import type { QueueItem } from './types';
const yt: QueueItem = { id: 'yt:1', videoId: '1', source: 'youtube', title: 'Afuera', artist: 'Caifanes', duration: 288, tags: [] };
const sp: QueueItem = { ...yt, id: 'sp:1', source: 'spotify', spotifyUri: 'spotify:track:1', duration: 290 };
describe('SourceResolver', () => {
 it('prefers Spotify for matching studio recordings', () => expect(resolveSource(yt, [sp]).source).toBe('spotify'));
 it.each(['live', 'remix', 'demo', 'bootleg', 'unreleased', 'session', 'rare'])('preserves %s on YouTube', tag => expect(resolveSource({ ...yt, tags: [tag] }, [sp]).source).toBe('youtube'));
 it('requires duration within five seconds', () => expect(resolveSource(yt, [{ ...sp, duration: 294 }]).source).toBe('youtube'));
 it('does not match a different artist', () => expect(resolveSource(yt, [{ ...sp, artist: 'Otra Banda' }]).source).toBe('youtube'));
 it('does not match unknown durations', () => expect(resolveSource({ ...yt, duration: 0 }, [{ ...sp, duration: 0 }]).source).toBe('youtube'));
 it('uses a strict 85 percent threshold', () => expect(resolveSource({ ...yt, title: 'abcdefghij' }, [{ ...sp, title: 'abcdefghZZ' }]).source).toBe('youtube'));
 it('normalizes accents and punctuation', () => expect(similarity('La Célula — Que Explota', 'la celula que explota')).toBe(1));
 it('handles empty inputs safely', () => expect(similarity('', '')).toBe(0));
});
