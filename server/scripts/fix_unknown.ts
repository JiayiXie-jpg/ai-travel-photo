// 本地跑：用豆包 Vision 修正关键风格的 unknown 模板性别
// npx tsx scripts/fix_unknown.ts

import sharp from 'sharp';

const ARK_API_KEY = '4154498e-7d71-451b-b1df-fb8fc922ea22';
const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const VISION_MODEL = 'doubao-seed-2-0-pro-260215';
const SERVER_URL = 'http://118.196.36.27:3000';
const ADMIN_TOKEN = 'admin123';

const TEMPLATES = [
  {id:1028, url:"https://www.lanmei66.cloud/test/album-images/1/89/5d86f11c-c817-40df-b07d-5517fd31549c.jpg"},
  {id:1034, url:"https://www.lanmei66.cloud/test/album-images/1/89/5d86f11c-c817-40df-b07d-5517fd31549c.jpg"},
  {id:1057, url:"https://www.lanmei66.cloud/test/album-images/2/358/6a38c9fd-0cb0-4de7-9e9b-6ad1cd692503.jpg"},
  {id:1059, url:"https://www.lanmei66.cloud/test/album-images/2/358/80a9fd1d-40c1-437f-a28d-d9831811f502.jpg"},
  {id:1060, url:"https://www.lanmei66.cloud/test/album-images/2/358/774b4eb4-7bcd-4418-9fee-4fc2a2493643.jpg"},
  {id:1063, url:"https://www.lanmei66.cloud/test/album-images/2/358/6a38c9fd-0cb0-4de7-9e9b-6ad1cd692503.jpg"},
  {id:1065, url:"https://www.lanmei66.cloud/test/album-images/2/358/80a9fd1d-40c1-437f-a28d-d9831811f502.jpg"},
  {id:1066, url:"https://www.lanmei66.cloud/test/album-images/2/358/774b4eb4-7bcd-4418-9fee-4fc2a2493643.jpg"},
  {id:1090, url:"https://www.lanmei66.cloud/test/album-images/2/337/ea4bb9c9-0b26-49b1-8f2b-35b34e5e291c.jpg"},
  {id:1092, url:"https://www.lanmei66.cloud/test/album-images/2/337/01b99b28-6d6b-4c86-a234-54bc99352d49.jpg"},
  {id:1094, url:"https://www.lanmei66.cloud/test/album-images/2/337/ea4bb9c9-0b26-49b1-8f2b-35b34e5e291c.jpg"},
  {id:1096, url:"https://www.lanmei66.cloud/test/album-images/2/337/01b99b28-6d6b-4c86-a234-54bc99352d49.jpg"},
  {id:1185, url:"https://www.lanmei66.cloud/test/album-images/2/411/1ba35f68-0618-4377-9cc1-c26f9d02e745.jpg"},
  {id:1188, url:"https://www.lanmei66.cloud/test/album-images/2/411/328bb8dd-554a-426c-a298-47a67e13c8ea.jpg"},
  {id:1191, url:"https://www.lanmei66.cloud/test/album-images/2/411/1ba35f68-0618-4377-9cc1-c26f9d02e745.jpg"},
  {id:1194, url:"https://www.lanmei66.cloud/test/album-images/2/411/328bb8dd-554a-426c-a298-47a67e13c8ea.jpg"},
];

// 缓存：同 URL 不重复调 API
const urlCache = new Map<string, 'male' | 'female' | 'unknown'>();

async function detectGender(imageUrl: string): Promise<'male' | 'female' | 'unknown'> {
  if (urlCache.has(imageUrl)) return urlCache.get(imageUrl)!;

  const imgResp = await fetch(imageUrl);
  const imgBuf = Buffer.from(await imgResp.arrayBuffer());
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
          { type: 'input_text', text: '这张照片中穿着民族服饰的人物是男性还是女性？只回答一个词：male 或 female。如果看不清或没有人物，回答 unknown。' },
        ],
      }],
    }),
  });

  if (!resp.ok) {
    console.error(`API error ${resp.status}: ${(await resp.text()).substring(0, 100)}`);
    return 'unknown';
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

  let gender: 'male' | 'female' | 'unknown' = 'unknown';
  if (text.includes('male') && !text.includes('female')) gender = 'male';
  else if (text.includes('female')) gender = 'female';

  urlCache.set(imageUrl, gender);
  return gender;
}

async function main() {
  console.log(`处理 ${TEMPLATES.length} 张模板...`);

  for (const tpl of TEMPLATES) {
    const gender = await detectGender(tpl.url);
    console.log(`#${tpl.id}: ${gender}`);

    // 写回服务器
    await fetch(`${SERVER_URL}/api/admin/templates/${tpl.id}/gender`, {
      method: 'PUT',
      headers: { 'X-Admin-Token': ADMIN_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ gender }),
    });
  }

  console.log('完成！');
}

main().catch(console.error);
