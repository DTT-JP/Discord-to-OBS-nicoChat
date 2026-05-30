// OBS クライアント側で実装されているシークレットエフェクト定義。
// choices で表示する名前・送信値・説明を一元管理する。
export const SECRET_EFFECTS = [
  {
    name: "gaming",
    value: "gaming",
    description: "文字色を虹色アニメーションにする",
  },
  {
    name: "reverse",
    value: "reverse",
    description: "流れる方向を反転する",
  },
  {
    name: "loop",
    value: "loop",
    description: "コメントをループ表示する",
  },
];

// このセットに含まれる名前のみ apply_secret イベントとして送信する。
// ユーザー入力をそのまま送信しないことで意図しないエフェクト名の流入を防ぐ。
export const KNOWN_SECRET_EFFECTS = new Set(SECRET_EFFECTS.map((effect) => effect.value));

export const SECRET_EFFECT_CHOICES = SECRET_EFFECTS.map(({ name, value }) => ({ name, value }));

export function normalizeSecretEffect(effectRaw) {
  return String(effectRaw ?? "").trim().toLowerCase();
}

export function isKnownSecretEffect(effectRaw) {
  return KNOWN_SECRET_EFFECTS.has(normalizeSecretEffect(effectRaw));
}
