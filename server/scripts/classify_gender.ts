// 本地跑的脚本：用豆包 Vision API 批量分类模板性别
// 运行: npx tsx scripts/classify_gender.ts

const ARK_API_KEY = '4154498e-7d71-451b-b1df-fb8fc922ea22';
const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const VISION_MODEL = 'doubao-seed-2-0-pro-260215';
const SERVER_URL = 'http://118.196.36.27:3000';
const ADMIN_TOKEN = 'admin123';
const CONCURRENCY = 10;

interface Template {
  id: number;
  image_url: string;
  style_name: string;
  gender: string;
}

async function callDoubaoGender(imageUrl: string): Promise<'male' | 'female' | 'unknown'> {
  // 下载图片
  const imgResp = await fetch(imageUrl);
  if (!imgResp.ok) throw new Error(`Download failed: ${imgResp.status}`);
  const imgBuf = Buffer.from(await imgResp.arrayBuffer());

  // 压缩转 base64
  const sharp = (await import('sharp')).default;
  const compressed = await sharp(imgBuf)
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();
  const base64Url = `data:image/jpeg;base64,${compressed.toString('base64')}`;

  const resp = await fetch(`${ARK_BASE_URL}/responses`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ARK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      input: [{
        role: 'user',
        content: [
          { type: 'input_image', image_url: base64Url },
          { type: 'input_text', text: '这张照片中的人物是男性还是女性？只回答一个词：male 或 female。如果看不清或没有人物，回答 unknown。' },
        ],
      }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Doubao API ${resp.status}: ${errText.substring(0, 200)}`);
  }

  const data = await resp.json() as any;
  let text = '';
  for (const item of data.output || []) {
    if (item.type === 'message') {
      for (const c of item.content || []) {
        if (c.type === 'output_text') text = c.text.trim().toLowerCase();
      }
    }
  }

  if (text.includes('male') && !text.includes('female')) return 'male';
  if (text.includes('female')) return 'female';
  return 'unknown';
}

async function main() {
  // 1. 获取所有未分类模板
  const resp = await fetch(`${SERVER_URL}/api/admin/templates?show_inactive=1`, {
    headers: { 'X-Admin-Token': ADMIN_TOKEN },
  });
  const data = await resp.json() as any;
  const all: Template[] = data.data || [];
  const todo = all.filter(t => !t.gender || t.gender === '');

  console.log(`共 ${all.length} 个模板，${todo.length} 个待分类`);
  if (todo.length === 0) {
    console.log('全部已分类！');
    return;
  }

  // 2. 并发处理
  let processed = 0;
  let failed = 0;
  const results: { id: number; gender: string }[] = [];

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (tpl) => {
        const gender = await callDoubaoGender(tpl.image_url);
        return { id: tpl.id, gender, style: tpl.style_name };
      })
    );

    for (const r of settled) {
      if (r.status === 'fulfilled') {
        results.push({ id: r.value.id, gender: r.value.gender });
        processed++;
        console.log(`[${processed}/${todo.length}] #${r.value.id} ${r.value.style}: ${r.value.gender}`);
      } else {
        failed++;
        console.error(`[FAIL] ${r.reason?.message?.substring(0, 100)}`);
      }
    }

    // 每 50 个写回一次数据库
    if (results.length >= 50 || i + CONCURRENCY >= todo.length) {
      await flushResults(results.splice(0));
    }
  }

  console.log(`\n完成！成功 ${processed}，失败 ${failed}`);
}

async function flushResults(results: { id: number; gender: string }[]) {
  if (results.length === 0) return;
  // 逐个更新（admin API 没有批量更新接口，直接用一个简单的方式）
  for (const r of results) {
    try {
      await fetch(`${SERVER_URL}/api/admin/templates/${r.id}/gender`, {
        method: 'PUT',
        headers: {
          'X-Admin-Token': ADMIN_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ gender: r.gender }),
      });
    } catch (e: any) {
      console.error(`Write back #${r.id} failed:`, e.message);
    }
  }
  console.log(`  -> 写回 ${results.length} 条`);
}

main().catch(console.error);
