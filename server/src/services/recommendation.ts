import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config';
import { getDb } from '../database';

// ─── 类型定义 ───

export interface RecommendResult {
  analysis: {
    estimated_age: string;
    gender: string;
    face_shape: string;
    body_type: string;
    style_keywords: string[];
  };
  recommendations: {
    style_name: string;
    reason: string;
    score: number;
    template_ids: number[];
    gender_matched: boolean; // 模板图片性别是否与用户匹配
    preview_url: string;     // 第一张模板的预览图 URL
  }[];
}

// ─── 服饰知识库（嵌入到 prompt 中） ───

const COSTUME_KNOWLEDGE = `
你是一位专业的服饰搭配顾问和摄影造型师。你需要分析用户照片，推荐最适合的旅拍/写真服饰。

⚠️ 性别规则（最高优先级）：
- 每种服饰都标注了【适合性别】，这是硬性限制
- 标注为"女"的服饰绝对不能推荐给男性
- 标注为"男女皆可"的服饰可以推荐给任何人
- 如果用户是男性，可选风格会很少，这是正常的。宁可只推荐 1-2 个真正合适的，也不要凑数推荐不合适的女性服饰

以下是所有可选的服饰风格，每种都有详细的适合人群描述：

## 彝族
- 服饰：黑色大披风斗篷 + 橙色边饰百褶长裙，金色/橙色刺绣，银饰高冠
- 适合性别：男女皆可（男性穿披风效果也很好，庄重大气）
- 适合年龄：19-45岁
- 适合脸型：鹅蛋脸、长脸（高头冠拉长比例）
- 适合体型：各体型友好（披风遮肉）
- 风格关键词：庄重、大气、民族

## 新中式彝族
- 服饰：冰蓝色修身套装 + 银色刺绣几何纹，黑色宽檐帽（银色流苏），银项圈
- 适合性别：男女皆可（中性时尚风格）
- 适合年龄：18-35岁
- 适合脸型：不限（帽子修饰脸型）
- 适合体型：偏瘦至标准（修身剪裁）
- 风格关键词：时尚民族、现代、清冷

## 阿细族
- 服饰：黑色坎肩 + 白色内衫，红蓝白粉彩色条纹围裙，红色高包头巾 + 银牌饰
- 适合性别：男女皆可（民族传统服饰男女皆有）
- 适合年龄：20-40岁
- 适合脸型：不限（包头巾修饰）
- 适合体型：各体型友好（宽松剪裁）
- 风格关键词：民俗、色彩丰富、质朴

## 傣族
- 服饰：淡蓝色透纱蕾丝短袖上衣 + 浅色筒裙，蝴蝶结发饰
- 适合性别：女
- 适合年龄：16-30岁
- 适合脸型：圆脸、鹅蛋脸（甜美风）
- 适合体型：偏瘦（上衣修身）
- 风格关键词：清新、甜美、田园

## 红色苗族
- 服饰：鲜红长袖上衣 + 白色纱裙，银色刺绣圆章，华丽苗银高冠、银项圈
- 适合性别：女
- 适合年龄：18-40岁
- 适合脸型：鹅蛋脸、圆脸（银冠增加高度）
- 适合体型：偏瘦至标准（上衣修身）
- 风格关键词：热烈、喜庆、华丽

## 苗族小朋友
- 服饰：儿童版苗族服饰，缩小版银冠 + 彩色苗绣衣裙
- 适合性别：女（儿童）
- 适合年龄：3-10岁（儿童专用）
- 风格关键词：童趣、可爱

## 旗袍
- 服饰：无袖立领旗袍，深墨绿色底配暗纹山水/植物印花，金色盘扣，搭配团扇
- 适合性别：女
- 适合年龄：25-50岁
- 适合脸型：鹅蛋脸、瓜子脸（立领修饰颈部）
- 适合体型：偏瘦至标准（旗袍要求身材曲线）
- 风格关键词：优雅、知性、传统

## 手推波旗袍
- 服饰：短袖立领旗袍，大胆花卉印花（红绿金），复古手推波发型、珍珠项链、红唇
- 适合性别：女
- 适合年龄：22-45岁
- 适合脸型：鹅蛋脸、方脸（手推波柔化脸型）
- 适合体型：标准至微胖（花卉印花有膨胀感，注意）
- 风格关键词：复古、老上海、摩登

## 大唐贵妃（高定）
- 服饰：华丽唐制大袖衫，蓝绿底配红橙团花，多层丝绸，露肩披帛，牡丹花髻
- 适合性别：女
- 适合年龄：20-40岁
- 适合脸型：圆脸、丰满脸（唐代审美以丰腴为美）
- 适合体型：各体型友好，微胖/丰满尤佳
- 风格关键词：华丽、雍容、戏剧化

## 锦鲤
- 服饰：超长飘逸红金色大袖裙，多层透纱翻飞如锦鲤游动，红白花簪
- 适合性别：女
- 适合年龄：18-35岁
- 适合脸型：不限（飘逸裙摆是视觉重心）
- 适合体型：偏瘦至标准（需展示飘逸舞姿）
- 风格关键词：视觉冲击、动态、仙气

## 战国袍
- 服饰：朱红色交领长袍，白色中衣，宽袖飘逸，黑色发带和金色步摇
- 适合性别：男女皆可（交领长袍本就是男女通用的古代服饰）
- 适合年龄：20-40岁
- 适合脸型：鹅蛋脸、长脸（古典发髻拉高比例）
- 适合体型：偏瘦至标准（交领汉服显气质）
- 风格关键词：古朴、诗意、文雅

## 小唯
- 服饰：白色露肩飘逸长裙，轻薄丝/麻质感，素色宽腰带，极简风（灵感自电影《画皮》）
- 适合性别：女
- 适合年龄：20-35岁
- 适合脸型：瓜子脸、鹅蛋脸（白衣配黑发对比鲜明）
- 适合体型：偏瘦（白色薄纱对身材要求高）
- 风格关键词：清冷、仙气、神秘

## 白色帷帽
- 服饰：白色/浅粉/淡蓝多层汉服齐胸裙，传统帷帽（长飘纱花饰帽）
- 适合性别：女
- 适合年龄：18-35岁
- 适合脸型：鹅蛋脸、瓜子脸（帷帽垂纱修饰脸型）
- 适合体型：偏瘦至标准
- 风格关键词：仙气飘飘、古风、清雅

## 精灵
- 服饰：绿色透纱仙气长裙（薄荷/翠绿/鼠尾草绿），金色长假发 + 花叶头冠
- 适合性别：女
- 适合年龄：16-30岁
- 适合脸型：瓜子脸、鹅蛋脸（适合精致五官）
- 适合体型：偏瘦（薄纱透光）
- 风格关键词：西方奇幻、精灵、Cosplay

## 赫本风
- 服饰：黑色丝绒/缎面吊带小黑裙（V领），宽檐黑色太阳帽（白花装饰），珍珠项链、红唇
- 适合性别：女
- 适合年龄：22-45岁
- 适合脸型：不限（宽檐帽修饰脸型极佳）
- 适合体型：各体型友好（小黑裙百搭）
- 风格关键词：西方复古、优雅、经典

## 红裙子
- 服饰：简约红色吊带/挂脖连衣裙，露肩设计，红玫瑰发饰
- 适合性别：女
- 适合年龄：20-35岁
- 适合脸型：不限（简约风不挑脸型）
- 适合体型：偏瘦至标准（需要肩颈线条好看）
- 风格关键词：浪漫、性感、简约

## 春樱限定
- 服饰：浅蓝色束腰系带蓬蓬裙，蕾丝边饰，Lolita/甜美风，蓝白蝴蝶结发带
- 适合性别：女
- 适合年龄：16-28岁
- 适合脸型：圆脸、鹅蛋脸（甜美风）
- 适合体型：偏瘦至标准（束腰凸显腰线）
- 风格关键词：少女感、日系甜美、Lolita

## 粉人鱼
- 服饰：梦幻粉色多层薄纱长裙，鱼尾裙摆，白色蕾丝胸衣，花朵贝壳头饰
- 适合性别：女
- 适合年龄：16-30岁
- 适合脸型：圆脸、鹅蛋脸（甜美风格）
- 适合体型：偏瘦至标准（薄纱透光）
- 风格关键词：公主风、梦幻、浪漫

## 仕女
- 服饰：古典仕女风汉服
- 适合性别：女
- 适合年龄：20-40岁
- 适合脸型：鹅蛋脸、瓜子脸
- 适合体型：偏瘦至标准
- 风格关键词：古典、端庄

## 织女
- 服饰：织女风格古装
- 适合性别：女
- 适合年龄：20-35岁
- 适合脸型：不限
- 适合体型：偏瘦至标准
- 风格关键词：仙气、古风

## 白色纱裙
- 服饰：白色纱质长裙
- 适合性别：女
- 适合年龄：18-35岁
- 适合脸型：不限
- 适合体型：偏瘦至标准
- 风格关键词：清新、仙气

## 粉色纱裙
- 服饰：粉色纱质长裙
- 适合性别：女
- 适合年龄：16-30岁
- 适合脸型：圆脸、鹅蛋脸
- 适合体型：偏瘦至标准
- 风格关键词：甜美、浪漫

## 日常装
- 服饰：现代休闲日常穿搭，非传统/民族服饰
- 适合性别：男女皆可
- 适合年龄：不限
- 适合脸型：不限
- 适合体型：不限
- 风格关键词：自然、写真、休闲
`;

const ANALYSIS_PROMPT = `
请仔细分析这张照片中的人物，并根据上述服饰知识库推荐最适合的服饰风格。

## 分析步骤（必须严格按照此顺序执行）

**第一步：判断性别**
观察面部特征、发型、体态，判断用户性别（男/女）。
- 这一步最关键！直接决定可选服饰范围。男性只能推荐标注为"男女皆可"的服饰。

**第二步：判断年龄**
仔细观察面部特征（皮肤状态、五官成熟度、面部轮廓），准确判断年龄段。

**第三步：分析脸型和体型**
- 脸型：鹅蛋脸/圆脸/方脸/长脸/瓜子脸
- 体型：偏瘦/标准/微胖/丰满

**第四步：感受气质风格**
- 判断整体气质倾向（如清新、优雅、甜美、大气、知性、阳刚、儒雅等）

**第五步：根据性别和年龄严格筛选可选风格**
⚠️ 硬性规则，绝对不能违反：
- 首先根据性别过滤：男性只能从"适合性别：男女皆可"的风格中选择，绝对禁止推荐标注为"女"的风格
- 然后根据年龄过滤：每种服饰都有适合年龄范围，年龄不在范围内不得推荐
- 儿童专属风格仅限 10 岁以下
- 如果过滤后可选风格很少（比如男性可能只有 3-5 个），这是正常的，不要凑数
- 宁可推荐 1-2 个真正合适的，也不要推荐 5 个不合适的

**第六步：输出推荐**

## 推荐规则
- 从年龄符合的风格中推荐 3-5 种最适合的
- 按匹配度从高到低排序，给出 1-100 的匹配分数
- 每个推荐给出具体理由，结合用户的脸型、体型、年龄、气质来说明为什么适合
- style_name 必须与知识库中的标题完全一致（如"彝族（民族服）"、"红色苗族"、"苗族小朋友"等）

请严格按照以下 JSON 格式返回，不要输出任何其他内容：
{
  "analysis": {
    "gender": "男 或 女",
    "estimated_age": "年龄段描述",
    "face_shape": "脸型",
    "body_type": "体型",
    "style_keywords": ["风格关键词1", "风格关键词2"]
  },
  "recommendations": [
    {
      "style_name": "服饰风格名称（必须与知识库或可选列表中的完全一致）",
      "reason": "推荐理由（50字以内，说明为什么适合这位用户）",
      "score": 95
    }
  ]
}
`;

// ─── 调用豆包 Vision API ───

interface ArkResponseOutput {
  id: string;
  output: {
    type: string;
    content: { type: string; text: string }[];
  }[];
  usage?: any;
}

async function callDoubaoVision(imageBase64: string, prompt: string): Promise<string> {
  const url = `${config.ark.baseUrl}/responses`;

  const body = {
    model: config.vision.model,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_image',
            image_url: imageBase64, // data:image/jpeg;base64,...
          },
          {
            type: 'input_text',
            text: prompt,
          },
        ],
      },
    ],
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.ark.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Doubao Vision API error ${resp.status}: ${errText}`);
  }

  const data = await resp.json() as ArkResponseOutput;

  // 从 output 中提取文本
  for (const item of data.output || []) {
    if (item.type === 'message') {
      for (const c of item.content || []) {
        if (c.type === 'output_text') {
          return c.text;
        }
      }
    }
  }

  throw new Error('Doubao Vision API returned no text output');
}

// ─── 豆包 Vision 性别检测（通过 URL） ───

export async function detectGenderByVision(imageUrl: string): Promise<'male' | 'female' | 'unknown'> {
  // 先下载图片转 base64（豆包 API 可能无法访问外部 URL）
  const imgResp = await fetch(imageUrl);
  if (!imgResp.ok) throw new Error(`Failed to download image: ${imgResp.status}`);
  const imgBuf = Buffer.from(await imgResp.arrayBuffer());
  const compressed = await sharp(imgBuf)
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();
  const base64Url = `data:image/jpeg;base64,${compressed.toString('base64')}`;

  const url = `${config.ark.baseUrl}/responses`;

  const body = {
    model: config.vision.model,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_image',
            image_url: base64Url,
          },
          {
            type: 'input_text',
            text: '这张照片中的人物是男性还是女性？只回答一个词：male 或 female。如果看不清或没有人物，回答 unknown。',
          },
        ],
      },
    ],
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.ark.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Doubao Vision API error ${resp.status}: ${errText}`);
  }

  const data = await resp.json() as ArkResponseOutput;

  let text = '';
  for (const item of data.output || []) {
    if (item.type === 'message') {
      for (const c of item.content || []) {
        if (c.type === 'output_text') {
          text = c.text.trim().toLowerCase();
        }
      }
    }
  }

  if (text.includes('male') && !text.includes('female')) return 'male';
  if (text.includes('female')) return 'female';
  return 'unknown';
}

// ─── 图片压缩（复用 volcengine 的逻辑） ───

async function photoToBase64(filename: string): Promise<string> {
  const filepath = path.join(config.paths.uploads, filename);
  if (!fs.existsSync(filepath)) {
    throw new Error(`用户照片不存在: ${filename}`);
  }

  const buffer = await sharp(filepath)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

// ─── 风格名 → 模板 ID 映射 ───

// 返回同性别的模板 ID 列表，同性别优先排序
function getTemplateIdsByStyle(styleName: string, shopId?: number, userGender?: string): number[] {
  const db = getDb();
  const shopFilter = shopId ? ' AND shop_id = ?' : '';
  const baseParams: any[] = shopId ? [shopId] : [];

  const isMale = userGender === '男' || userGender === 'male';
  const isFemale = userGender === '女' || userGender === 'female';

  // 同性别排前面，unknown 排后面，异性排最后
  let orderClause = ' ORDER BY id DESC';
  if (isMale) {
    orderClause = " ORDER BY CASE WHEN gender='male' THEN 0 WHEN gender='unknown' THEN 1 ELSE 2 END, id DESC";
  } else if (isFemale) {
    orderClause = " ORDER BY CASE WHEN gender='female' THEN 0 WHEN gender='unknown' THEN 1 ELSE 2 END, id DESC";
  }

  // 精确匹配
  let sql = `SELECT id FROM templates WHERE is_active = 1 AND style_name = ?${shopFilter}${orderClause} LIMIT 20`;
  let rows = db.prepare(sql).all(styleName, ...baseParams) as { id: number }[];
  if (rows.length > 0) return rows.map(r => r.id);

  // 模糊匹配
  sql = `SELECT id FROM templates WHERE is_active = 1 AND style_name LIKE ?${shopFilter}${orderClause} LIMIT 40`;
  rows = db.prepare(sql).all(`%${styleName}%`, ...baseParams) as { id: number }[];
  return rows.map(r => r.id);
}

// ─── 获取数据库中实际可用的单人风格列表 ───

// 包含"小朋友"/"亲子"/"闺蜜"/"情侣"/"母女"/"全家福"/"孕妇"等关键词的为特殊人群，不推荐给普通成人单人
const CHILD_KEYWORDS = ['小朋友', '小宝'];
const GROUP_KEYWORDS = ['亲子', '闺蜜', '情侣', '母女', '全家福', '孕妇', '牛郎织女', '青蛇白蛇'];

function getAvailableStyles(shopId?: number): { soloAdult: string[]; childOnly: string[]; all: string[]; hasMale: Set<string> } {
  const db = getDb();
  let sql = `SELECT DISTINCT style_name FROM templates WHERE is_active = 1`;
  const params: any[] = [];
  if (shopId) { sql += ' AND shop_id = ?'; params.push(shopId); }
  sql += ' ORDER BY style_name';
  const rows = db.prepare(sql).all(...params) as { style_name: string }[];
  const all = rows.map(r => r.style_name);

  const childOnly: string[] = [];
  const soloAdult: string[] = [];

  for (const name of all) {
    const isChild = CHILD_KEYWORDS.some(k => name.includes(k));
    const isGroup = GROUP_KEYWORDS.some(k => name.includes(k));
    if (isChild) {
      childOnly.push(name);
    } else if (!isGroup) {
      soloAdult.push(name);
    }
  }

  // 查出有 male 模板的风格
  const maleRows = db.prepare(`
    SELECT DISTINCT style_name FROM templates
    WHERE is_active = 1 AND gender = 'male'${shopId ? ' AND shop_id = ?' : ''}
  `).all(...(shopId ? [shopId] : [])) as { style_name: string }[];
  const hasMale = new Set(maleRows.map(r => r.style_name));

  return { soloAdult, childOnly, all, hasMale };
}

// ─── 主推荐函数 ───

export async function recommendCostumes(
  userPhotoFilename: string,
  shopId?: number,
): Promise<RecommendResult> {
  // 1. 读取并压缩用户照片
  const imageBase64 = await photoToBase64(userPhotoFilename);

  // 2. 从数据库获取可用风格列表
  const styles = getAvailableStyles(shopId);

  // 3. 拼接完整 prompt（包含可用风格白名单）
  const styleListPrompt = `
⚠️ 重要：你只能从以下风格名称中进行推荐，style_name 必须与列表中的完全一致，不得编造：

### 数据库中实际可用的单人风格（白名单）：
${styles.soloAdult.map(s => `- ${s}`).join('\n')}

### 儿童专属风格（仅 10 岁以下可推荐）：
${styles.childOnly.map(s => `- ${s}`).join('\n')}

### 拥有男性参考图的风格（男性用户务必优先推荐这些）：
${[...styles.hasMale].filter(s => styles.soloAdult.includes(s)).map(s => `- ${s}`).join('\n') || '- （暂无）'}

规则：
- 如果照片中是男性成人，只能推荐知识库中标注"适合性别：男女皆可"且在上述白名单中的风格
- ⚠️ 男性用户务必优先推荐"拥有男性参考图"的风格，即使匹配度略低也应排在前面
- 如果照片中是女性成人，可推荐白名单中标注"适合性别：女"或"男女皆可"的风格
- 如果照片中是 10 岁以下儿童，必须优先推荐儿童专属风格
- 绝对禁止向成年人推荐儿童专属风格
`;

  const fullPrompt = COSTUME_KNOWLEDGE + '\n' + styleListPrompt + '\n' + ANALYSIS_PROMPT;

  // 3. 调用豆包 Vision API
  console.log(`[Recommend] Calling Doubao Vision for ${userPhotoFilename}...`);
  const rawResponse = await callDoubaoVision(imageBase64, fullPrompt);
  console.log(`[Recommend] Raw response length: ${rawResponse.length}`);

  // 4. 解析 JSON
  let result: RecommendResult;
  try {
    // 尝试提取 JSON（可能被 markdown 代码块包裹）
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    const parsed = JSON.parse(jsonMatch[0]);
    result = {
      analysis: {
        estimated_age: parsed.analysis?.estimated_age || '未知',
        gender: parsed.analysis?.gender || '未知',
        face_shape: parsed.analysis?.face_shape || '未知',
        body_type: parsed.analysis?.body_type || '未知',
        style_keywords: parsed.analysis?.style_keywords || [],
      },
      recommendations: [],
    };
    const userGender = result.analysis.gender;
    const isMale = userGender === '男' || userGender === 'male';
    const isFemale = userGender === '女' || userGender === 'female';
    result.recommendations = (parsed.recommendations || []).map((r: any) => {
      const ids = getTemplateIdsByStyle(r.style_name, shopId, userGender);
      // 检查返回的模板是否包含同性别的（不含 unknown 兜底的情况）
      let genderMatched = true;
      if (ids.length > 0 && (isMale || isFemale)) {
        const db = getDb();
        const targetGender = isMale ? 'male' : 'female';
        const matched = db.prepare(`SELECT COUNT(*) as c FROM templates WHERE id IN (${ids.map(() => '?').join(',')}) AND gender = ?`).get(...ids, targetGender) as { c: number };
        genderMatched = matched.c > 0;
      }
      // 获取第一张同性别模板的预览图（优先严格同性别，不用 unknown）
      let previewUrl = '';
      if (ids.length > 0) {
        const db2 = getDb();
        const targetGender = isMale ? 'male' : isFemale ? 'female' : '';
        if (targetGender) {
          const sameGender = db2.prepare(`SELECT image_url FROM templates WHERE id IN (${ids.map(() => '?').join(',')}) AND gender = ? LIMIT 1`).get(...ids, targetGender) as { image_url: string } | undefined;
          if (sameGender) previewUrl = sameGender.image_url;
        }
        // 如果没有严格同性别的，取第一张
        if (!previewUrl) {
          const first = db2.prepare('SELECT image_url FROM templates WHERE id = ?').get(ids[0]) as { image_url: string } | undefined;
          if (first) previewUrl = first.image_url;
        }
      }
      return {
        style_name: r.style_name || '',
        reason: r.reason || '',
        score: r.score || 0,
        template_ids: ids,
        gender_matched: genderMatched,
        preview_url: previewUrl,
      };
    });
  } catch (parseErr: any) {
    console.error(`[Recommend] JSON parse error:`, parseErr.message);
    console.error(`[Recommend] Raw response:`, rawResponse.substring(0, 500));
    throw new Error('AI 分析结果解析失败，请重试');
  }

  // 5. 过滤掉没有匹配模板的推荐（如果指定了 shopId）
  if (shopId) {
    result.recommendations = result.recommendations.filter(r => r.template_ids.length > 0);
  }

  // 6. 男性/女性用户：有同性别模板的推荐排前面（即使匹配分低一些也优先展示）
  result.recommendations.sort((a, b) => {
    // gender_matched 的排前面
    if (a.gender_matched && !b.gender_matched) return -1;
    if (!a.gender_matched && b.gender_matched) return 1;
    // 同组内按 score 排序
    return b.score - a.score;
  });

  console.log(`[Recommend] Done. ${result.recommendations.length} recommendations.`);
  return result;
}
