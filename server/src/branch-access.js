import { db } from './db.js';

export function resolveBranchId(auth, requestedId) {
  if (auth.branchId) {
    if (requestedId && Number(requestedId) !== auth.branchId) throw new Error('You can only record activity for your assigned branch.');
    return auth.branchId;
  }
  const id = Number(requestedId);
  if (!Number.isInteger(id) || id < 1) throw new Error('Choose a branch for this activity.');
  const branch = db.prepare('SELECT id FROM branches WHERE id=? AND active=1').get(id);
  if (!branch) throw new Error('Choose an active branch.');
  return branch.id;
}
