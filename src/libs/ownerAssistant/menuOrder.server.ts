import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import {
  adminSalonMembershipSchema,
  ownerAssistantMenuOperationSchema,
  salonSchema,
  serviceMenuRevisionSchema,
  serviceSchema,
} from '@/models/Schema';

export type MenuItem = { id: string; name: string; sortOrder: number | null };
export type MenuProposal = {
  id: string;
  status: 'ready' | 'no_op';
  oldOrder: MenuItem[];
  newOrder: MenuItem[];
};
export type MenuReceipt = {
  id: string;
  status: 'applied' | 'already_applied' | 'undone' | 'already_undone' | 'undo_unavailable';
  proposalId: string;
  oldOrder: MenuItem[];
  newOrder: MenuItem[];
  currentOrder: MenuItem[];
};

const MENU_PROPOSAL_MAX_AGE_MS = 15 * 60 * 1000;

export class MenuOrderError extends Error {
  constructor(readonly code: 'STALE' | 'UNDO_UNAVAILABLE' | 'INVALID_ORDER' | 'NOT_FOUND', message: string) {
    super(message);
  }
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function isRetryableTransactionError(error: unknown): boolean {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = candidate?.code ?? candidate?.cause?.code;
  return code === '40P01' || code === '40001';
}

async function inRetriedTransaction<T>(operation: (tx: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.transaction(operation);
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === 2) {
        throw error;
      }
    }
  }
  throw new Error('Unreachable transaction retry state');
}

async function lockSalonGate(tx: Transaction, salonId: string): Promise<void> {
  // A parent-row lock queues FK-backed service inserts while an assistant
  // action is validating its complete menu snapshot.
  const [salon] = await tx
    .select({ id: salonSchema.id })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .for('update')
    .limit(1);
  if (!salon) {
    throw new MenuOrderError('NOT_FOUND', 'Salon not found.');
  }
}

async function lockRevisionGate(tx: Transaction, salonId: string): Promise<number> {
  await lockSalonGate(tx, salonId);
  await tx.insert(serviceMenuRevisionSchema)
    .values({ salonId, revision: 0 })
    .onConflictDoNothing();
  const [revision] = await tx
    .select({ revision: serviceMenuRevisionSchema.revision })
    .from(serviceMenuRevisionSchema)
    .where(eq(serviceMenuRevisionSchema.salonId, salonId))
    .for('update')
    .limit(1);
  if (!revision) {
    throw new Error('Service menu revision was not available.');
  }
  return revision.revision;
}

async function lockedMenu(tx: Transaction, salonId: string): Promise<MenuItem[]> {
  const locked = await tx
    .select({ id: serviceSchema.id, name: serviceSchema.name, sortOrder: serviceSchema.sortOrder })
    .from(serviceSchema)
    .where(eq(serviceSchema.salonId, salonId))
    // Lock in immutable primary-key order. The display order is mutable and
    // cannot safely determine a cross-writer lock order.
    .orderBy(asc(serviceSchema.id))
    .for('update');
  return locked.sort((left, right) => (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id));
}

async function lockStableMenu(tx: Transaction, salonId: string): Promise<{ menu: MenuItem[]; revision: number }> {
  // Existing service writers take a row lock before the database trigger bumps
  // the revision. Match that order, then re-read after the parent/revision
  // gate is held: an insert that won the small first-read window is included;
  // a later FK-backed insert queues behind the parent lock.
  await lockedMenu(tx, salonId);
  const revision = await lockRevisionGate(tx, salonId);
  return { menu: await lockedMenu(tx, salonId), revision };
}

async function assertStillOwner(tx: Transaction, salonId: string, actorAdminId: string): Promise<void> {
  // The route authenticates first; this transaction-local recheck prevents a
  // membership revoke that waits behind menu locks from being bypassed.
  const [membership] = await tx.select({ adminId: adminSalonMembershipSchema.adminId })
    .from(adminSalonMembershipSchema)
    .where(and(
      eq(adminSalonMembershipSchema.salonId, salonId),
      eq(adminSalonMembershipSchema.adminId, actorAdminId),
      eq(adminSalonMembershipSchema.role, 'owner'),
    ))
    .for('share')
    .limit(1);
  if (!membership) {
    throw new MenuOrderError('NOT_FOUND', 'This owner action is no longer available.');
  }
}

async function lockOrdinaryMenu(tx: Transaction, salonId: string): Promise<MenuItem[]> {
  // The existing UI must remain usable against a pre-0078 database while the
  // assistant flag is off. It still shares the same parent/service row lock
  // discipline, without reading the new revision/receipt tables.
  await lockedMenu(tx, salonId);
  await lockSalonGate(tx, salonId);
  return lockedMenu(tx, salonId);
}

function assertCompletePermutation(menu: readonly MenuItem[], orderedIds: readonly string[]): void {
  if (menu.length === 0 || menu.length !== orderedIds.length || new Set(orderedIds).size !== orderedIds.length) {
    throw new MenuOrderError('INVALID_ORDER', 'The requested order must contain every service exactly once.');
  }
  const available = new Set(menu.map(service => service.id));
  if (orderedIds.some(id => !available.has(id))) {
    throw new MenuOrderError('INVALID_ORDER', 'One or more services are not on this salon’s menu.');
  }
}

function menuInRequestedOrder(menu: readonly MenuItem[], orderedIds: readonly string[]): MenuItem[] {
  const names = new Map(menu.map(item => [item.id, item.name]));
  return orderedIds.map((id, index) => ({ id, name: names.get(id)!, sortOrder: index + 1 }));
}

function sameOrder(left: readonly MenuItem[], right: readonly MenuItem[]): boolean {
  return left.length === right.length && left.every((item, index) => item.id === right[index]?.id && item.sortOrder === right[index]?.sortOrder);
}

function sameIds(left: readonly MenuItem[], orderedIds: readonly string[]): boolean {
  return left.length === orderedIds.length && left.every((item, index) => item.id === orderedIds[index]);
}

async function writeOrder(tx: Transaction, salonId: string, order: readonly MenuItem[]): Promise<void> {
  const updatedAt = new Date();
  for (const item of order) {
    await tx.update(serviceSchema).set({ sortOrder: item.sortOrder, updatedAt }).where(and(eq(serviceSchema.id, item.id), eq(serviceSchema.salonId, salonId)));
  }
}

/** Shared by the ordinary service menu UI and assistant actions. */
export async function reorderSalonMenu(salonId: string, orderedIds: readonly string[]): Promise<MenuItem[]> {
  return inRetriedTransaction(async (tx) => {
    const menu = await lockOrdinaryMenu(tx, salonId);
    assertCompletePermutation(menu, orderedIds);
    const next = sameIds(menu, orderedIds) ? menu : menuInRequestedOrder(menu, orderedIds);
    if (!sameOrder(menu, next)) {
      await writeOrder(tx, salonId, next);
    }
    return next;
  });
}

export async function getOwnerAssistantMenu(salonId: string): Promise<{ menu: MenuItem[]; revision: number }> {
  return inRetriedTransaction(tx => lockStableMenu(tx, salonId));
}

export async function getMenuOperation(input: { salonId: string; actorAdminId: string; proposalId: string }): Promise<MenuReceipt | MenuProposal> {
  return inRetriedTransaction(async (tx) => {
    const operation = await findOperation(tx, input.salonId, input.actorAdminId, input.proposalId);
    if (operation.status === 'ready' || operation.status === 'no_op') {
      return { id: operation.id, status: operation.status, oldOrder: operation.oldOrder, newOrder: operation.newOrder };
    }
    return {
      id: operation.id,
      proposalId: operation.id,
      status: operation.status === 'applied' ? 'applied' : 'undone',
      oldOrder: operation.oldOrder,
      newOrder: operation.newOrder,
      currentOrder: operation.status === 'applied' ? operation.newOrder : operation.oldOrder,
    };
  });
}

export async function prepareMenuOrder(input: { salonId: string; actorAdminId: string; idempotencyKey: string; orderedIds: string[] }): Promise<MenuProposal> {
  return inRetriedTransaction(async (tx) => {
    const { revision, menu } = await lockStableMenu(tx, input.salonId);
    await assertStillOwner(tx, input.salonId, input.actorAdminId);
    const existing = await tx.select().from(ownerAssistantMenuOperationSchema).where(and(
      eq(ownerAssistantMenuOperationSchema.idempotencyKey, input.idempotencyKey),
      eq(ownerAssistantMenuOperationSchema.salonId, input.salonId),
      eq(ownerAssistantMenuOperationSchema.actorAdminId, input.actorAdminId),
    )).for('update');
    const prior = existing[0];
    if (prior) {
      if (prior.status !== 'ready' && prior.status !== 'no_op') {
        throw new MenuOrderError('INVALID_ORDER', 'This idempotency key has already completed a menu action.');
      }
      if (!sameIds(prior.newOrder, input.orderedIds)) {
        throw new MenuOrderError('INVALID_ORDER', 'This idempotency key was already used for a different menu order.');
      }
      return { id: prior.id, status: prior.status, oldOrder: prior.oldOrder, newOrder: prior.newOrder };
    }
    assertCompletePermutation(menu, input.orderedIds);
    const unchanged = sameIds(menu, input.orderedIds);
    const next = unchanged ? menu : menuInRequestedOrder(menu, input.orderedIds);
    const status = unchanged ? 'no_op' : 'ready';
    const id = `oamo_${crypto.randomUUID()}`;
    await tx.insert(ownerAssistantMenuOperationSchema).values({ id, salonId: input.salonId, actorAdminId: input.actorAdminId, idempotencyKey: input.idempotencyKey, status, baseRevision: revision, oldOrder: menu, newOrder: next });
    return { id, status, oldOrder: menu, newOrder: next };
  });
}

async function findOperation(tx: Transaction, salonId: string, actorAdminId: string, proposalId: string) {
  const [operation] = await tx.select().from(ownerAssistantMenuOperationSchema).where(and(
    eq(ownerAssistantMenuOperationSchema.id, proposalId),
    eq(ownerAssistantMenuOperationSchema.salonId, salonId),
    eq(ownerAssistantMenuOperationSchema.actorAdminId, actorAdminId),
  )).for('update').limit(1);
  if (!operation) {
    throw new MenuOrderError('NOT_FOUND', 'This menu proposal is not available.');
  }
  return operation;
}

export async function applyMenuOrder(input: { salonId: string; actorAdminId: string; proposalId: string }): Promise<MenuReceipt> {
  return inRetriedTransaction(async (tx) => {
    const operation = await findOperation(tx, input.salonId, input.actorAdminId, input.proposalId);
    if (operation.status === 'applied') {
      return { id: operation.id, proposalId: operation.id, status: 'already_applied', oldOrder: operation.oldOrder, newOrder: operation.newOrder, currentOrder: operation.newOrder };
    }
    if (operation.status === 'undone') {
      throw new MenuOrderError('STALE', 'This proposal has already been undone.');
    }
    if (operation.createdAt.getTime() + MENU_PROPOSAL_MAX_AGE_MS < Date.now()) {
      throw new MenuOrderError('STALE', 'This proposal expired. Review a new proposal.');
    }
    const { revision, menu } = await lockStableMenu(tx, input.salonId);
    await assertStillOwner(tx, input.salonId, input.actorAdminId);
    if (revision !== operation.baseRevision || !sameOrder(menu, operation.oldOrder)) {
      throw new MenuOrderError('STALE', 'Your menu changed after this preview. Review a new proposal.');
    }
    if (operation.status === 'no_op') {
      return { id: operation.id, proposalId: operation.id, status: 'already_applied', oldOrder: operation.oldOrder, newOrder: operation.newOrder, currentOrder: operation.oldOrder };
    }
    await writeOrder(tx, input.salonId, operation.newOrder);
    const [after] = await tx.select({ revision: serviceMenuRevisionSchema.revision }).from(serviceMenuRevisionSchema).where(eq(serviceMenuRevisionSchema.salonId, input.salonId)).limit(1);
    await tx.update(ownerAssistantMenuOperationSchema).set({ status: 'applied', appliedRevision: after!.revision, appliedAt: new Date(), updatedAt: new Date() }).where(and(eq(ownerAssistantMenuOperationSchema.id, operation.id), eq(ownerAssistantMenuOperationSchema.salonId, input.salonId), eq(ownerAssistantMenuOperationSchema.actorAdminId, input.actorAdminId)));
    return { id: operation.id, proposalId: operation.id, status: 'applied', oldOrder: operation.oldOrder, newOrder: operation.newOrder, currentOrder: operation.newOrder };
  });
}

export async function undoMenuOrder(input: { salonId: string; actorAdminId: string; proposalId: string }): Promise<MenuReceipt> {
  return inRetriedTransaction(async (tx) => {
    const operation = await findOperation(tx, input.salonId, input.actorAdminId, input.proposalId);
    if (operation.status === 'undone') {
      return { id: operation.id, proposalId: operation.id, status: 'already_undone', oldOrder: operation.oldOrder, newOrder: operation.newOrder, currentOrder: operation.oldOrder };
    }
    if (operation.status !== 'applied') {
      return { id: operation.id, proposalId: operation.id, status: 'undo_unavailable', oldOrder: operation.oldOrder, newOrder: operation.newOrder, currentOrder: operation.oldOrder };
    }
    const { revision, menu } = await lockStableMenu(tx, input.salonId);
    await assertStillOwner(tx, input.salonId, input.actorAdminId);
    if (revision !== operation.appliedRevision || !sameOrder(menu, operation.newOrder)) {
      throw new MenuOrderError('UNDO_UNAVAILABLE', 'The menu changed after this action, so it cannot be safely undone.');
    }
    await writeOrder(tx, input.salonId, operation.oldOrder);
    await tx.update(ownerAssistantMenuOperationSchema).set({ status: 'undone', undoneAt: new Date(), updatedAt: new Date() }).where(and(eq(ownerAssistantMenuOperationSchema.id, operation.id), eq(ownerAssistantMenuOperationSchema.salonId, input.salonId), eq(ownerAssistantMenuOperationSchema.actorAdminId, input.actorAdminId)));
    return { id: operation.id, proposalId: operation.id, status: 'undone', oldOrder: operation.oldOrder, newOrder: operation.newOrder, currentOrder: operation.oldOrder };
  });
}
