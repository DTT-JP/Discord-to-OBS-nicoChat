// OBS クライアント側で実装されているシークレットエフェクト名の正規セット。
// このセットに含まれる名前のみ apply_secret イベントとして送信する。
// ユーザー入力をそのまま送信しないことで意図しないエフェクト名の流入を防ぐ。
export const KNOWN_SECRET_EFFECTS = new Set(["gaming", "reverse", "loop"]);
