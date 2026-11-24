export interface LayerGroup {
  /** Stable session identifier used by layer assignments. */
  id: string;
  /** Editable, non-empty display name. */
  name: string;
  /** Shared visibility applied to every currently assigned layer. */
  visible: boolean;
  /** Ordered layer IDs assigned to this group; each layer may occur once globally. */
  layerIds: string[];
}

export type LayerMove = 'raise' | 'lower';
export type LayerDropPlacement = 'before' | 'after';

export function assignLayerToGroup(groups: LayerGroup[], layerId: string, targetGroupId?: string): void {
  for (const group of groups) group.layerIds = group.layerIds.filter(id => id !== layerId);
  if (!targetGroupId) return;
  const target = groups.find(group => group.id === targetGroupId);
  if (!target) throw new Error(`Layer group not found: ${targetGroupId}`);
  target.layerIds.push(layerId);
}

export function moveLayer(order: string[], layerId: string, direction: LayerMove): string[] {
  const current = order.indexOf(layerId);
  if (current < 0) throw new Error(`Layer not found in display order: ${layerId}`);
  const next = direction === 'raise' ? current - 1 : current + 1;
  if (next < 0 || next >= order.length) return [...order];
  const result = [...order];
  [result[current], result[next]] = [result[next]!, result[current]!];
  return result;
}

/** Repositions one layer in the top-to-bottom display order without mutation. */
export function repositionLayer(order: string[], layerId: string, targetId: string, placement: LayerDropPlacement): string[] {
  if (!order.includes(layerId)) throw new Error(`Layer not found in display order: ${layerId}`);
  if (!order.includes(targetId)) throw new Error(`Target layer not found in display order: ${targetId}`);
  if (layerId === targetId) return [...order];
  const result = order.filter(id => id !== layerId);
  const targetIndex = result.indexOf(targetId);
  result.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, layerId);
  return result;
}
