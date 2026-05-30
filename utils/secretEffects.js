// OBS クライアント側の内部機能定義。
export const SECRET_EFFECTS = [
  {
    name: "gaming",
    value: "gaming",
  },
  {
    name: "reverse",
    value: "reverse",
  },
  {
    name: "loop",
    value: "loop",
  },
];

// このセットに含まれる名前のみ内部イベントとして送信する。
// ユーザー入力をそのまま送信しないことで意図しない値の流入を防ぐ。
export const KNOWN_SECRET_EFFECTS = new Set(SECRET_EFFECTS.map((effect) => effect.value));

export function normalizeSecretEffect(effectRaw) {
  return String(effectRaw ?? "").trim().toLowerCase();
}

export function isKnownSecretEffect(effectRaw) {
  return KNOWN_SECRET_EFFECTS.has(normalizeSecretEffect(effectRaw));
}
