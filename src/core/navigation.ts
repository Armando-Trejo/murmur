export const viewIds = ['home', 'search', 'library', 'connections'] as const;
export type ViewId = typeof viewIds[number];
export function resolveView(value: string): { view: ViewId; invalid: boolean } {
  const candidate = value.replace(/^#\/?|^\//, '').split('?')[0];
  return viewIds.includes(candidate as ViewId) ? { view: candidate as ViewId, invalid: false } : { view: 'home', invalid: !!candidate };
}
