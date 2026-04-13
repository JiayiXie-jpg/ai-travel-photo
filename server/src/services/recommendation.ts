import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config';
import { getDb } from '../database';

// ─── 类型定义 ───

export interface RecommendResult {
  analysis: {
    estimated_age: string;
    face_shape: string;
    body_type: string;
    style_keywords: string[];
  };
  recommendations: {
    style_name: string;
    reason: string;
    score: number;
    template_ids: number[];
  }[];
}

// ─── 服饰知识库（嵌入到 prompt 中） ───

const COSTUME_KNOWLEDGE = `
你是一位专业的服饰搭配顾问和摄影造型师。你需要分析用户照片，推荐最适合的旅拍/写真服饰。

以下是所有可选的服饰风格，每种都有详细的适合人群描述：

## 彝族（民族服）
- 服饰：黑色大披风斗篷 + 橙色边饰百褶长裙，金色/橙色刺绣，银饰高冠
- 适合年龄：19-45岁
- 适合脸型：鹅蛋脸、长脸（高头冠拉长比例）
- 适合体型：各体型友好（披风遮肉）
- 风格关键词：庄重、大气、民族

## 新中式彝族
- 服饰：冰蓝色修身套装 + 银色刺绣几何纹，黑色宽檐帽（银色流苏），银项圈
- 适合年龄：18-35岁
- 适合脸型：不限（帽子修饰脸型）
- 适合体型：偏瘦至标准（修身剪裁）
- 风格关键词：时尚民族、现代、清冷

## 阿细族
- 服饰：黑色坎肩 + 白色内衫，红蓝白粉彩色条纹围裙，红色高包头巾 + 银牌饰
- 适合年龄：20-40岁
- 适合脸型：不限（包头巾修饰）
- 适合体型：各体型友好（宽松剪裁）
- 风格关键词：民俗、色彩丰富、质朴

## 傣族（民族服）
- 服饰：淡蓝色透纱蕾丝短袖上衣 + 浅色筒裙，蝴蝶结发饰
- 适合年龄：16-30岁
- 适合脸型：圆脸、鹅蛋脸（甜美风）
- 适合体型：偏瘦（上衣修身）
- 风格关键词：清新、甜美、田园

## 红色苗族
- 服饰：鲜红长袖上衣 + 白色纱裙，银色刺绣圆章，华丽苗银高冠、银项圈
- 适合年龄：18-40岁
- 适合脸型：鹅蛋脸、圆脸（银冠增加高度）
- 适合体型：偏瘦至标准（上衣修身）
- 风格关键词：热烈、喜庆、华丽

## 苗族小朋友
- 服饰：儿童版苗族服饰，缩小版银冠 + 彩色苗绣衣裙
- 适合年龄：3-10岁（儿童专用）
- 风格关键词：童趣、可爱

## 旗袍
- 服饰：无袖立领旗袍，深墨绿色底配暗纹山水/植物印花，金色盘扣，搭配团扇
- 适合年龄：25-50岁
- 适合脸型：鹅蛋脸、瓜子脸（立领修饰颈部）
- 适合体型：偏瘦至标准（旗袍要求身材曲线）
- 风格关键词：优雅、知性、传统

## 手推波旗袍
- 服饰：短袖立领旗袍，大胆花卉印花（红绿金），复古手推波发型、珍珠项链、红唇
- 适合年龄：22-45岁
- 适合脸型：鹅蛋脸、方脸（手推波柔化脸型）
- 适合体型：标准至微胖（花卉印花有膨胀感，注意）
- 风格关键词：复古、老上海、摩登

## 大唐贵妃（高定汉服）
- 服饰：华丽唐制大袖衫，蓝绿底配红橙团花，多层丝绸，露肩披帛，牡丹花髻
- 适合年龄：20-40岁
- 适合脸型：圆脸、丰满脸（唐代审美以丰腴为美）
- 适合体型：各体型友好，微胖/丰满尤佳
- 风格关键词：华丽、雍容、戏剧化

## 锦鲤（汉服）
- 服饰：超长飘逸红金色大袖裙，多层透纱翻飞如锦鲤游动，红白花簪
- 适合年龄：18-35岁
- 适合脸型：不限（飘逸裙摆是视觉重心）
- 适合体型：偏瘦至标准（需展示飘逸舞姿）
- 风格关键词：视觉冲击、动态、仙气

## 战国袍（汉服）
- 服饰：朱红色交领长袍，白色中衣，宽袖飘逸，黑色发带和金色步摇
- 适合年龄：20-40岁
- 适合脸型：鹅蛋脸、长脸（古典发髻拉高比例）
- 适合体型：偏瘦至标准（交领汉服显气质）
- 风格关键词：古朴、诗意、文雅

## 小唯（汉服）
- 服饰：白色露肩飘逸长裙，轻薄丝/麻质感，素色宽腰带，极简风（灵感自电影《画皮》）
- 适合年龄：20-35岁
- 适合脸型：瓜子脸、鹅蛋脸（白衣配黑发对比鲜明）
- 适合体型：偏瘦（白色薄纱对身材要求高）
- 风格关键词：清冷、仙气、神秘

## 白色帷帽
- 服饰：白色/浅粉/淡蓝多层汉服齐胸裙，传统帷帽（长飘纱花饰帽）
- 适合年龄：18-35岁
- 适合脸型：鹅蛋脸、瓜子脸（帷帽垂纱修饰脸型）
- 适合体型：偏瘦至标准
- 风格关键词：仙气飘飘、古风、清雅

## 精灵
- 服饰：绿色透纱仙气长裙（薄荷/翠绿/鼠尾草绿），金色长假发 + 花叶头冠
- 适合年龄：16-30岁
- 适合脸型：瓜子脸、鹅蛋脸（适合精致五官）
- 适合体型：偏瘦（薄纱透光）
- 风格关键词：西方奇幻、精灵、Cosplay

## 赫本风
- 服饰：黑色丝绒/缎面吊带小黑裙（V领），宽檐黑色太阳帽（白花装饰），珍珠项链、红唇
- 适合年龄：22-45岁
- 适合脸型：不限（宽檐帽修饰脸型极佳）
- 适合体型：各体型友好（小黑裙百搭）
- 风格关键词：西方复古、优雅、经典

## 红裙子
- 服饰：简约红色吊带/挂脖连衣裙，露肩设计，红玫瑰发饰
- 适合年龄：20-35岁
- 适合脸型：不限（简约风不挑脸型）
- 适合体型：偏瘦至标准（需要肩颈线条好看）
- 风格关键词：浪漫、性感、简约

## 春樱限定
- 服饰：浅蓝色束腰系带蓬蓬裙，蕾丝边饰，Lolita/甜美风，蓝白蝴蝶结发带
- 适合年龄：16-28岁
- 适合脸型：圆脸、鹅蛋脸（甜美风）
- 适合体型：偏瘦至标准（束腰凸显腰线）
- 风格关键词：少女感、日系甜美、Lolita

## 粉人鱼
- 服饰：梦幻粉色多层薄纱长裙，鱼尾裙摆，白色蕾丝胸衣，花朵贝壳头饰
- 适合年龄：16-30岁
- 适合脸型：圆脸、鹅蛋脸（甜美风格）
- 适合体型：偏瘦至标准（薄纱透光）
- 风格关键词：公主风、梦幻、浪漫

## 日常装
- 服饰：现代休闲日常穿搭，非传统/民族服饰
- 适合年龄：不限
- 适合脸型：不限
- 适合体型：不限
- 风格关键词：自然、写真、休闲
`;

const ANALYSIS_PROMPT = `
请仔细分析这张照片中的人物，并根据上述服饰知识库推荐最适合的服饰风格。

分析要求：
1. 判断人物的大致年龄段
2. 分析脸型（鹅蛋脸/圆脸/方脸/长脸/瓜子脸等）
3. 分析体型（偏瘦/标准/微胖/丰满）
4. 感受人物的整体气质和风格倾向
5. 如果是儿童（10岁以下），必须推荐"苗族小朋友"

推荐要求：
- 推荐 3-5 种最适合的服饰风格
- 每种都要给出具体理由，说明为什么适合这位用户
- 按匹配度从高到低排序，给出 1-100 的匹配分数
- 理由要有针对性，结合用户的脸型、体型、年龄、气质来说明
- 注意服饰的年龄和体型限制，不要推荐明显不合适的

请严格按照以下 JSON 格式返回，不要输出任何其他内容：
{
  "analysis": {
    "estimated_age": "年龄段描述",
    "face_shape": "脸型",
    "body_type": "体型",
    "style_keywords": ["风格关键词1", "风格关键词2"]
  },
  "recommendations": [
    {
      "style_name": "服饰风格名称（必须与知识库中的名称完全一致）",
      "reason": "推荐理由（50字以内）",
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

function getTemplateIdsByStyle(styleName: string, shopId?: number): number[] {
  const db = getDb();
  let sql = `SELECT id FROM templates WHERE is_active = 1 AND style_name LIKE ?`;
  const params: any[] = [`%${styleName}%`];

  if (shopId) {
    sql += ' AND shop_id = ?';
    params.push(shopId);
  }

  sql += ' LIMIT 20';

  const rows = db.prepare(sql).all(...params) as { id: number }[];
  return rows.map(r => r.id);
}

// ─── 主推荐函数 ───

export async function recommendCostumes(
  userPhotoFilename: string,
  shopId?: number,
): Promise<RecommendResult> {
  // 1. 读取并压缩用户照片
  const imageBase64 = await photoToBase64(userPhotoFilename);

  // 2. 拼接完整 prompt
  const fullPrompt = COSTUME_KNOWLEDGE + '\n' + ANALYSIS_PROMPT;

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
        face_shape: parsed.analysis?.face_shape || '未知',
        body_type: parsed.analysis?.body_type || '未知',
        style_keywords: parsed.analysis?.style_keywords || [],
      },
      recommendations: (parsed.recommendations || []).map((r: any) => ({
        style_name: r.style_name || '',
        reason: r.reason || '',
        score: r.score || 0,
        template_ids: getTemplateIdsByStyle(r.style_name, shopId),
      })),
    };
  } catch (parseErr: any) {
    console.error(`[Recommend] JSON parse error:`, parseErr.message);
    console.error(`[Recommend] Raw response:`, rawResponse.substring(0, 500));
    throw new Error('AI 分析结果解析失败，请重试');
  }

  // 5. 过滤掉没有匹配模板的推荐（如果指定了 shopId）
  if (shopId) {
    result.recommendations = result.recommendations.filter(r => r.template_ids.length > 0);
  }

  console.log(`[Recommend] Done. ${result.recommendations.length} recommendations.`);
  return result;
}
