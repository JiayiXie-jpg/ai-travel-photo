import { config } from '../config';
import { getDb } from '../database';

interface SyncResult {
  shopsSync: number;
  albumsSync: number;
  imagesSync: number;
  skipped: number;
  errors: string[];
}

interface LanmeiShop {
  id: number;
  shopCode: string;
  shopName: string;
  homeImage: string | null;
}

interface LanmeiParentCategory {
  id: number;
  name: string;
  shopId: number;
}

interface LanmeiAlbum {
  id: number;
  shopId: number;
  childId: number;
  title: string;
  coverImageUrl: string;
  price: number;
  childName: string;
  parentId: number;
}

interface LanmeiAlbumImage {
  id: number;
  shopId: number;
  albumId: number;
  imageUrl: string;
  sortOrder: number;
}

// 带 token 请求
async function apiGet(token: string, path: string): Promise<any> {
  const resp = await fetch(`${config.lanmei.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return resp.json();
}

// 主同步函数
export async function syncFromRemote(): Promise<SyncResult> {
  const result: SyncResult = { shopsSync: 0, albumsSync: 0, imagesSync: 0, skipped: 0, errors: [] };
  const db = getDb();

  console.log('[Sync] Starting remote sync...');

  // 临时忽略自签名证书
  const prevTLS = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  // 1. 登录（同时获取店铺列表）
  let token: string;
  let shops: LanmeiShop[] = [];
  try {
    const resp = await fetch(`${config.lanmei.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: config.lanmei.username,
        password: config.lanmei.password,
      }),
    });
    const loginData = await resp.json() as any;
    if (loginData.code !== 200 || !loginData.data?.token) {
      result.errors.push(`Login failed: ${loginData.message || 'unknown'}`);
      return result;
    }
    token = loginData.data.token;
    shops = loginData.data.shopList || [];
    console.log('[Sync] Login successful, shops:', shops.length);
  } catch (err: any) {
    result.errors.push(`Login failed: ${err.message}`);
    return result;
  }

  // 同步店铺
  const upsertShop = db.prepare(`
    INSERT INTO shops (id, shop_code, shop_name, home_image) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET shop_code=excluded.shop_code, shop_name=excluded.shop_name, home_image=excluded.home_image
  `);
  for (const shop of shops) {
    upsertShop.run(shop.id, shop.shopCode, shop.shopName, shop.homeImage || '');
    result.shopsSync++;
  }
  console.log(`[Sync] Synced ${result.shopsSync} shops`);

  // 3. 按店铺同步
  const checkExist = db.prepare('SELECT id FROM templates WHERE remote_album_id = ? AND shop_id = ? AND category = ? LIMIT 1');
  const insertTemplate = db.prepare(`
    INSERT INTO templates (style_name, image_path, image_url, scene_prompt, category, package_type, sub_category, shop_id, shop_name, remote_album_id)
    VALUES (?, '', ?, '', ?, ?, ?, ?, ?, ?)
  `);
  const CATEGORIES = ['tryon', 'travel'];

  for (const shop of shops) {
    console.log(`[Sync] Syncing shop: ${shop.shopName} (id=${shop.id})`);

    // 获取一级分类（用于映射 parentId → package_type 名称）
    const parentRes = await apiGet(token, `/shop/parent/list?shopId=${shop.id}`);
    const parentMap = new Map<number, string>();
    if (parentRes.code === 200 && parentRes.data) {
      for (const p of parentRes.data as LanmeiParentCategory[]) {
        parentMap.set(p.id, p.name);
      }
    }

    // 获取相册列表
    const albumRes = await apiGet(token, `/photo-albums/photo?shop_id=${shop.id}`);
    if (albumRes.code !== 200 || !albumRes.data) {
      result.errors.push(`Failed to get albums for shop ${shop.id}: ${albumRes.message || 'unknown'}`);
      continue;
    }

    const albums: LanmeiAlbum[] = albumRes.data;
    console.log(`[Sync] Found ${albums.length} albums for ${shop.shopName}`);

    for (const album of albums) {
      const packageType = (parentMap.get(album.parentId) || '').trim();
      const subCategory = (album.childName || '').trim();

      // 每张图同时插入 tryon 和 travel 两条记录
      for (const cat of CATEGORIES) {
        // 检查该 category 是否已同步
        const existing = checkExist.get(album.id, shop.id, cat);
        if (existing) {
          result.skipped++;
          continue;
        }

        // 插入封面图作为第一张模板
        if (album.coverImageUrl) {
          insertTemplate.run(
            album.title,
            album.coverImageUrl,
            cat,
            packageType,
            subCategory,
            shop.id,
            shop.shopName,
            album.id,
          );
          result.albumsSync++;
        }

        // 获取相册内所有图片
        try {
          const imgRes = await apiGet(token, `/photo-albums/albums/get?albumId=${album.id}&shopId=${shop.id}`);
          if (imgRes.code === 200 && imgRes.data) {
            const images: LanmeiAlbumImage[] = imgRes.data;
            for (const img of images) {
              if (img.imageUrl === album.coverImageUrl) continue;
              insertTemplate.run(
                album.title,
                img.imageUrl,
                cat,
                packageType,
                subCategory,
                shop.id,
                shop.shopName,
                album.id,
              );
              result.imagesSync++;
            }
          }
        } catch (err: any) {
          result.errors.push(`Failed to get images for album ${album.id}: ${err.message}`);
        }
      }
    }
  }

  // 恢复 TLS 验证
  if (prevTLS === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTLS;

  console.log(`[Sync] Done. Albums: ${result.albumsSync}, Images: ${result.imagesSync}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`);
  return result;
}
