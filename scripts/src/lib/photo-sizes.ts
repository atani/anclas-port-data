import type { PlayerPhoto } from "./types.js";

/**
 * 顔写真のサイズ別URLを復元する。
 *
 * 選手ページは原寸の1枚しか出さないため、素直に読むと4サイズすべてが原寸になる。
 * 一覧画面は18人分を同時に並べるので、原寸のままだと転送量が7.5MBに達する。
 * WordPress はアップロード時に `-150x150` のような派生画像を作るため、URLを
 * 組み立てて実在を確かめ、あるものだけ採用する。無ければ原寸へ落とす。
 */
const SIZE_SUFFIX: Record<"thumbnail" | "medium", string> = {
  thumbnail: "150x150",
  medium: "300x300",
};

/** WordPress の派生画像URL。拡張子の直前にサイズを挟む規則に従う。 */
export function derivePhotoSizeUrl(url: string, size: string): string | null {
  const parts = url.match(/^(.*)(\.(?:jpe?g|png|webp))$/i);
  if (!parts) return null;
  return `${parts[1]}-${size}${parts[2]}`;
}

/**
 * `exists` は実在確認。ネットワークを持ち込まずに試せるよう引数で受ける。
 */
export async function resolvePhotoSizes(
  photo: PlayerPhoto,
  exists: (url: string) => Promise<boolean>,
): Promise<PlayerPhoto> {
  const full = photo.full;
  if (!full) return photo;

  const resolved: PlayerPhoto = { ...photo };
  for (const key of ["thumbnail", "medium"] as const) {
    const candidate = derivePhotoSizeUrl(full, SIZE_SUFFIX[key]);
    if (!candidate) continue;
    if (await exists(candidate)) resolved[key] = candidate;
  }
  return resolved;
}

/**
 * 縮小版を1人も採用できなかったときに、前回値から引き継ぐ。
 *
 * HEAD が通らない環境では全員が原寸のまま残る。生成は成功扱いなので気づけず、
 * 一覧の転送量だけが数十倍になる。原寸URLが前回と同じ選手に限って引き継ぐため、
 * 写真が差し替わっていれば別URLになり、古い写真を出すことはない。
 */
export function carryForwardPhotoSizes(photo: PlayerPhoto, previous: PlayerPhoto): PlayerPhoto {
  if (!photo.full || previous.full !== photo.full) return photo;
  const carried: PlayerPhoto = { ...photo };
  for (const key of ["thumbnail", "medium"] as const) {
    const old = previous[key];
    if (old && old !== previous.full) carried[key] = old;
  }
  return carried;
}
