import { describe, it, expect } from 'vitest';
import { resolveView } from './navigation';
describe('navigation recovery', () => {
  it.each(['home','search','library','connections'])('resolves %s without a blank view', view => expect(resolveView('#/'+view)).toEqual({view,invalid:false}));
  it.each(['#/missing','/settings-deleted','#/../../secret'])('recovers invalid route %s', path => expect(resolveView(path)).toEqual({view:'home',invalid:true}));
  it('treats the root as Inicio', () => expect(resolveView('')).toEqual({view:'home',invalid:false}));
});
