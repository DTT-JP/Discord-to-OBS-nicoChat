import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * アプリケーションバージョン。
 * package.json の version フィールドを単一の真実源として参照する。
 * バージョンを変更する際は package.json のみ編集すればよい。
 */
export const VERSION = require("../package.json").version;
