let applySecretFn = null;

export function setApplySecretFn(fn) {
  applySecretFn = fn;
}

export function applySecretToSockets(socketIds, effect, value) {
  if (!applySecretFn) {
    console.error("[secret] applySecretFn が未登録です");
    return false;
  }

  applySecretFn(socketIds, effect, value);
  return true;
}
