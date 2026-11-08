const pending = new Set();
export function runBackground(task, label) {
  const promise = Promise.resolve().then(task).catch((error) => console.error(`${label}:`, error.message)).finally(() => pending.delete(promise));
  pending.add(promise);
  return promise;
}
export async function drainBackground() {
  while (pending.size) await Promise.allSettled([...pending]);
}
