const stores = new Set<Map<string, unknown>>();

/** ร่างอยู่ในหน่วยความจำเท่านั้น และถูกล้างเมื่อสิ้นสุดบัญชีที่เข้าสู่ระบบ */
export function createDraftStore<T>() {
  const store = new Map<string, T>();
  stores.add(store);
  return store;
}

export function clearDrafts() {
  for (const store of stores) store.clear();
}

export const draftKeyFor = (userId: string, documentId: string) => JSON.stringify([userId, documentId]);
