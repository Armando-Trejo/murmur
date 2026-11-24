import { describe, it, expect } from 'vitest';
import { parseFanUpload, parseChapters } from './FanUploadParser';
describe('FanUploadParser', () => {
 it('extracts a candidate artist without using the uploader account', () => { const r = parseFanUpload('Caifanes - Afuera [Official Video] (HQ) 4K Sub Español'); expect(r.candidateArtist).toBe('Caifanes'); expect(r.title).toBe('Afuera'); });
 it.each(['Misfits | Rare demo', 'Caifanes: En vivo', 'Misfits - Unreleased Bootleg', 'Artista - Inédita', 'Artista — Full Set Live Session'])('preserves rarity tags: %s', title => { expect(parseFanUpload(title).forceYouTube).toBe(true); expect(parseFanUpload(title).tags.length).toBeGreaterThan(0); });
 it('does not invent an artist for an unstructured title', () => expect(parseFanUpload('An amazing concert').artist).toBe('Artista por identificar'));
 it('sorts, deduplicates and validates concert timestamps', () => { expect(parseChapters('01:02:03 Final\n0:00 Intro\n03:10 Afuera\n03:10 Duplicado\n04:99 Inválido\n99:00 Fuera', 4000)).toEqual([{ title: 'Intro', positionMs: 0 }, { title: 'Duplicado', positionMs: 190000 }, { title: 'Final', positionMs: 3723000 }]); });
 it('ignores timestamps for videos of 15 minutes or less', () => expect(parseChapters('0:00 Intro', 900)).toEqual([]));
 it('supports titles before timestamps and brackets', () => expect(parseChapters('Afuera [12:45]', 1000)).toEqual([{ title: 'Afuera', positionMs: 765000 }]));
});
