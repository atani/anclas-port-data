import type { ShopItem } from "./types.js";

const SHOP_URL = "https://anclas.base.shop/";

/** HTMLエンティティの最小デコード */
function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)));
}

/**
 * anclas.base.shop のトップHTMLから商品一覧を抽出する。
 * 各商品: <a href="/items/{id}"> ... itemTitleText ... price ... img ... </a>
 */
export function parseShopItems(html: string): ShopItem[] {
  const items: ShopItem[] = [];
  const seen = new Set<string>();
  const linkRe =
    /<a[^>]*href="(https:\/\/anclas\.base\.shop\/items\/(\d+))"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const url = m[1] ?? "";
    const id = m[2] ?? "";
    const block = m[3] ?? "";
    if (seen.has(id)) continue;

    const imgMatch = block.match(/<img[^>]*src="([^"]+)"/);
    const nameMatch = block.match(/items-grid_itemTitleText[^>]*>([^<]+)</);
    const priceMatch = block.match(/items-grid_price[^>]*>([^<]+)</);
    if (!imgMatch || !nameMatch || !priceMatch) continue;

    items.push({
      id,
      name: decode(nameMatch[1]?.trim() ?? ""),
      price: decode(priceMatch[1]?.trim() ?? ""),
      imageUrl: imgMatch[1] ?? "",
      url,
    });
    seen.add(id);
  }
  return items;
}

export async function fetchShopItems(): Promise<ShopItem[]> {
  try {
    const res = await fetch(SHOP_URL, {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; anclas-port-pipeline)" },
    });
    if (!res.ok) return [];
    return parseShopItems(await res.text());
  } catch {
    return [];
  }
}
