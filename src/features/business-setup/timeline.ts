type Turn = { id: string; message: string; reply: string | null; status: string; createdAt: Date; leaseExpiresAt: Date; designOperationId: string | null };
type Design = { id: string; message: string; status: string; createdAt: Date };

/** Both owner entry points display the same saved conversation after refresh. */
export function setupTimeline(turns: Turn[], designs: Design[], now = Date.now()) {
  const linked = new Set(turns.map(turn => turn.designOperationId).filter(Boolean));
  const designById = new Map(designs.map(design => [design.id, design]));
  const designStatus = (design: Design) => ['pending', 'generated'].includes(design.status) ? (design.createdAt.getTime() + 300000 < now ? 'interrupted' : 'pending') : design.status;
  return [
    ...turns.map(turn => ({ ...turn, status: turn.designOperationId && designById.has(turn.designOperationId) ? designStatus(designById.get(turn.designOperationId)!) : ['pending', 'generated'].includes(turn.status) ? (turn.leaseExpiresAt.getTime() < now ? 'interrupted' : 'pending') : turn.status })),
    ...designs.filter(design => !linked.has(design.id)).map(design => ({ ...design, status: designStatus(design), reply: design.status === 'completed' ? 'Your updated website design is saved as a draft. Open Preview to review the result.' : null })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(-40).map(({ id, message, reply, status }) => ({ id, message, reply, status }));
}
