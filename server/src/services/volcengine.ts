import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config';
import { detectFaceBox, FaceBox } from './faceDetect';
import { getSetting } from '../database';

interface ArkImageResponse {
  model?: string;
  created?: number;
  data?: Array<{ url: string; size?: string }>;
  usage?: { generated_images: number; output_tokens: number; total_tokens: number };
  error?: { code: string; message: string; param?: string; type?: string };
}

export interface GenerateResult {
  success: boolean;
  imageUrl?: string;
  localPath?: string;
  error?: string;
}

// 图片转 base64 data URL（自适应压缩，单张不超过 3MB）
const MAX_DIMENSION = 4096;
const JPEG_QUALITY = 95;
const MAX_BYTES = 3 * 1024 * 1024;

async function bufferToDataUrl(buffer: Buffer): Promise<string> {
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

async function fileToDataUrl(filePath: string): Promise<string> {
  let dim = MAX_DIMENSION;
  let quality = JPEG_QUALITY;
  let buffer: Buffer;

  while (true) {
    buffer = await sharp(filePath)
      .resize(dim, dim, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
    if (buffer.length <= MAX_BYTES) break;
    if (quality > 80) { quality -= 5; continue; }
    dim = Math.floor(dim * 0.8);
    quality = JPEG_QUALITY;
  }

  console.log(`[Ark] Compressed ${path.basename(filePath)}: ${fs.statSync(filePath).size} -> ${buffer.length} bytes (dim=${dim}, q=${quality})`);
  return bufferToDataUrl(buffer);
}

// 硬编码默认 prompt（兜底）
const DEFAULT_FULL_PROMPT = 'Replace the face in image 2 with the face in image 1. The facial contour and facial details must be completely consistent with the character in image 1 to ensure a high degree of similarity. The hairstyle and makeup must perfectly match the character in image 2. Keep the hairstyle, clothing, pose, background, and lighting from image 2 unchanged. Maintain the aspect ratio of image 2. Generate 4K images. The facial contours and details must perfectly match the person in Image 1 to ensure high similarity.';

const DEFAULT_FACE_PROMPT = 'Replace the face in image 2 with the face in image 1. The output face must be 100% identical to image 1: same face shape, same eyes (size, shape, double/single eyelid), same nose (bridge height, tip shape), same mouth (lip thickness, shape), same jawline, same skin tone, same facial proportions. The person in the output must be immediately recognizable as the same person in image 1. Keep the angle, lighting, and hair from image 2 unchanged. Generate the highest possible facial similarity to image 1.';

const DEFAULT_TRYON_TEMPLATE = 'This is a virtual try-on task. Image 1 is the person (user photo). Image 2 is the clothing reference only. Image 3 is a close-up of the person\'s face from image 1 for facial detail reference. Generate a photo of the EXACT same person from image 1 wearing the outfit from image 2. CRITICAL REQUIREMENTS: 1) The face must be 100% identical to image 1 and image 3 - same face shape, same eyes (size, shape, double/single eyelid), same nose (bridge height, tip shape), same mouth (lip thickness, shape), same jawline, same skin tone, same facial proportions. The person must be immediately recognizable as the same person. 2) The hairstyle must be exactly the same as image 1 - same hair color, same hair length, same hair style, same parting. Do NOT change the hairstyle. 3) Keep the background and pose from image 1. 4) Only change the clothing to match image 2.';

const DEFAULT_TRYON_TEMPLATE_NO_FACE = 'This is a virtual try-on task. Image 1 is the person (user photo). Image 2 is the clothing reference only. Generate a photo of the EXACT same person from image 1 wearing the outfit from image 2. CRITICAL REQUIREMENTS: 1) The face must be 100% identical to image 1 - same face shape, same eyes, same nose, same mouth, same jawline, same skin tone, same facial proportions. The person must be immediately recognizable as the same person in image 1. 2) The hairstyle must be exactly the same as image 1 - same hair color, same hair length, same hair style, same parting. Do NOT change the hairstyle. 3) Keep the background and pose from image 1. 4) Only change the clothing to match image 2.';

// 获取有效 prompt：模板级 > 全局设置 > 硬编码默认
function getEffectivePrompt(settingKey: string, defaultValue: string, scenePrompt?: string): string {
  if (scenePrompt && scenePrompt.trim()) return scenePrompt.trim();
  const globalSetting = getSetting(settingKey);
  if (globalSetting && globalSetting.trim()) return globalSetting.trim();
  return defaultValue;
}

// AI试衣 prompt（保留用户体型）— 动态拼接体型和年龄
function buildTryonPrompt(bodyType?: string, ageRange?: string, scenePrompt?: string): string {
  let bodyDesc = '';
  if (bodyType === '瘦') bodyDesc = 'slim and slender';
  else if (bodyType === '微胖') bodyDesc = 'slightly chubby';
  else if (bodyType === '胖') bodyDesc = 'plus-size';

  let ageDesc = '';
  if (ageRange) {
    const map: Record<string, string> = {
      '10岁及以下': 'a child under 10 years old',
      '11-18岁': 'a teenager aged 11-18',
      '19-30岁': 'a young adult aged 19-30',
      '31-45岁': 'an adult aged 31-45',
      '46-60岁': 'a middle-aged person aged 46-60',
      '60岁以上': 'an elderly person over 60',
    };
    ageDesc = map[ageRange] || '';
  }

  let personDesc = 'the person in image 1';
  if (bodyDesc || ageDesc) {
    const parts = [ageDesc, bodyDesc ? `with a ${bodyDesc} body type` : ''].filter(Boolean);
    personDesc = `the person in image 1 (${parts.join(', ')})`;
  }

  // 获取 prompt 模板（模板级 > 全局设置 > 硬编码默认），然后替换占位符
  const template = getEffectivePrompt('prompt_tryon', DEFAULT_TRYON_TEMPLATE, scenePrompt);
  return template
    .replace(/\$\{personDesc\}/g, personDesc)
    .replace(/\$\{bodyDesc\}/g, bodyDesc || 'natural');
}

// API 要求最小像素数
const MIN_PIXELS = 3686400;

// 对齐到 8 的倍数
function alignTo8(n: number): number {
  return Math.ceil(n / 8) * 8;
}

// 计算输出尺寸（满足最小像素要求）
async function calcOutputSize(templateFile: string): Promise<string> {
  const meta = await sharp(templateFile).metadata();
  const w = meta.width || 1920;
  const h = meta.height || 1920;
  const ratio = w / h;

  let outH = Math.ceil(Math.sqrt(MIN_PIXELS / ratio));
  let outW = Math.ceil(outH * ratio);

  outW = alignTo8(outW);
  outH = alignTo8(outH);

  console.log(`[Ark] Template ${w}x${h} (ratio ${ratio.toFixed(2)}) -> output ${outW}x${outH} (${outW * outH} px)`);
  return `${outW}x${outH}`;
}

// 计算脸部裁剪的输出尺寸（对齐到 8，满足最小像素要求）
function calcFaceOutputSize(box: FaceBox): string {
  let w = alignTo8(box.width);
  let h = alignTo8(box.height);

  // 确保满足最小像素要求，不够就按比例放大
  while (w * h < MIN_PIXELS) {
    w = alignTo8(Math.ceil(w * 1.2));
    h = alignTo8(Math.ceil(h * 1.2));
  }

  return `${w}x${h}`;
}

// 生成椭圆形羽化 mask（中心不透明，边缘渐变透明）
async function createFeatherMask(width: number, height: number, featherPx: number): Promise<Buffer> {
  // 用 SVG 画一个带羽化边缘的椭圆
  const cx = width / 2;
  const cy = height / 2;
  const rx = cx - featherPx;
  const ry = cy - featherPx;

  // 确保半径为正
  const safeRx = Math.max(rx, width * 0.3);
  const safeRy = Math.max(ry, height * 0.3);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <radialGradient id="g" cx="50%" cy="50%" rx="${safeRx / width * 100}%" ry="${safeRy / height * 100}%">
        <stop offset="70%" stop-color="white" stop-opacity="1"/>
        <stop offset="100%" stop-color="white" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
  </svg>`;

  return sharp(Buffer.from(svg))
    .png()
    .toBuffer();
}

// 调用 Ark API
async function callArkApi(
  imageDataUrls: string[],
  prompt: string,
  size: string,
): Promise<ArkImageResponse> {
  const body = {
    model: config.ark.model,
    prompt,
    image: imageDataUrls,
    size,
  };

  console.log(`[Ark] API call, body size: ${JSON.stringify(body).length} bytes, size: ${size}`);

  const resp = await fetch(`${config.ark.baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ark.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  console.log(`[Ark] Response status: ${resp.status}, body preview: ${text.substring(0, 300)}`);

  return JSON.parse(text) as ArkImageResponse;
}

// 下载远程图片
async function downloadImage(url: string): Promise<Buffer> {
  const resp = await fetch(url);
  return Buffer.from(await resp.arrayBuffer());
}

// 方案 A：裁剪换贴（高精度换脸）
async function cropSwapPasteBack(
  templateFile: string,
  userFile: string,
  tplBox: FaceBox,
  userBox: FaceBox,
  scenePrompt?: string,
): Promise<GenerateResult> {
  console.log('[Ark] Using crop-swap-paste strategy');

  // 1. 裁剪两张脸
  const tplFaceBuffer = await sharp(templateFile)
    .extract(tplBox)
    .jpeg({ quality: 95 })
    .toBuffer();

  const userFaceBuffer = await sharp(userFile)
    .extract(userBox)
    .jpeg({ quality: 95 })
    .toBuffer();

  console.log(`[Ark] Template face crop: ${tplFaceBuffer.length} bytes (${tplBox.width}x${tplBox.height})`);
  console.log(`[Ark] User face crop: ${userFaceBuffer.length} bytes (${userBox.width}x${userBox.height})`);

  // 2. 转 data URL
  const userFaceDataUrl = await bufferToDataUrl(userFaceBuffer);
  const tplFaceDataUrl = await bufferToDataUrl(tplFaceBuffer);

  // 3. 调用 API 换脸（只换脸部区域）
  const facePrompt = getEffectivePrompt('prompt_travel_face', DEFAULT_FACE_PROMPT, scenePrompt);
  const faceSize = calcFaceOutputSize(tplBox);
  const result = await callArkApi(
    [userFaceDataUrl, tplFaceDataUrl],
    facePrompt,
    faceSize,
  );

  if (result.error) {
    return { success: false, error: `${result.error.code}: ${result.error.message}` };
  }

  if (!result.data || result.data.length === 0 || !result.data[0].url) {
    return { success: false, error: '未获取到生成结果' };
  }

  // 4. 下载换脸结果
  const swappedBuffer = await downloadImage(result.data[0].url);
  console.log(`[Ark] Downloaded swapped face: ${swappedBuffer.length} bytes`);

  // 5. Resize 换脸结果到模板脸部区域大小
  const resizedSwapped = await sharp(swappedBuffer)
    .resize(tplBox.width, tplBox.height, { fit: 'fill' })
    .png() // 用 PNG 保留后续 composite 质量
    .toBuffer();

  // 6. 生成羽化 mask
  const featherPx = Math.round(Math.min(tplBox.width, tplBox.height) * 0.08);
  const mask = await createFeatherMask(tplBox.width, tplBox.height, featherPx);

  // 7. 给换脸结果加上 alpha mask
  const swappedWithAlpha = await sharp(resizedSwapped)
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 8. 贴回模板原图
  const finalBuffer = await sharp(templateFile)
    .composite([{
      input: swappedWithAlpha,
      left: tplBox.left,
      top: tplBox.top,
      blend: 'over',
    }])
    .jpeg({ quality: 95 })
    .toBuffer();

  console.log(`[Ark] Final image: ${finalBuffer.length} bytes`);

  // 保存结果到 results 目录
  const { v4: uuidv4 } = require('uuid');
  const filename = `${uuidv4()}.jpg`;
  const filepath = path.join(config.paths.results, filename);
  fs.writeFileSync(filepath, finalBuffer);

  const localUrl = `${config.baseUrl}/results/${filename}`;
  return { success: true, imageUrl: localUrl, localPath: filename };
}

// 方案 B：全图换脸
async function fullImageSwap(
  templateFile: string,
  userFile: string,
  category: string = 'travel',
  extra: { body_type?: string; age_range?: string; template_image_url?: string } = {},
  scenePrompt?: string,
): Promise<GenerateResult> {
  console.log(`[Ark] Using full-image swap strategy, category=${category}`);

  let imageInputs: string[];
  let hasFaceCrop = false;

  if (category === 'tryon') {
    // tryon 模式：用 URL 传图（模型能更好地区分 image 1 和 image 2）
    const userUrl = `${config.baseUrl}/uploads/${path.basename(userFile)}`;
    const templateUrl = extra.template_image_url || `${config.baseUrl}/templates/${path.basename(templateFile)}`;
    console.log(`[Ark] Tryon URL mode: user=${userUrl}, template=${templateUrl}`);
    imageInputs = [userUrl, templateUrl];

    // 尝试裁剪用户脸部特写作为第三张参考图，增强脸部还原度
    try {
      const faceBox = await detectFaceBox(userFile, 0.15, 0.15, 0.15, 0.15);
      if (faceBox) {
        const faceCropBuffer = await sharp(userFile)
          .extract(faceBox)
          .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 90 })
          .toBuffer();
        // 保存到 uploads 目录，通过 URL 传给 API
        const { v4: uuidv4 } = require('uuid');
        const faceFilename = `face_${uuidv4()}.jpg`;
        const facePath = path.join(config.paths.uploads, faceFilename);
        fs.writeFileSync(facePath, faceCropBuffer);
        const faceUrl = `${config.baseUrl}/uploads/${faceFilename}`;
        imageInputs.push(faceUrl);
        hasFaceCrop = true;
        console.log(`[Ark] Face crop added as image 3: ${faceUrl} (${faceBox.width}x${faceBox.height} -> ${faceCropBuffer.length} bytes)`);
      } else {
        console.log('[Ark] No face detected in user photo, using 2-image mode');
      }
    } catch (faceErr: any) {
      console.log(`[Ark] Face crop failed: ${faceErr.message}, using 2-image mode`);
    }
  } else {
    // travel 模式：用 base64（保持原有逻辑）
    const userDataUrl = await fileToDataUrl(userFile);
    const templateDataUrl = await fileToDataUrl(templateFile);
    console.log(`[Ark] Travel base64 mode: user=${userDataUrl.length}, template=${templateDataUrl.length}`);
    imageInputs = [userDataUrl, templateDataUrl];
  }

  // 根据是否有脸部裁剪选择 prompt
  let prompt: string;
  if (category === 'tryon') {
    if (hasFaceCrop) {
      prompt = scenePrompt?.trim() || getEffectivePrompt('prompt_tryon', DEFAULT_TRYON_TEMPLATE, undefined);
    } else {
      prompt = scenePrompt?.trim() || getEffectivePrompt('prompt_tryon', DEFAULT_TRYON_TEMPLATE_NO_FACE, undefined);
    }
    // 如果有体型/年龄描述，替换占位符
    if (extra.body_type || extra.age_range) {
      prompt = buildTryonPrompt(extra.body_type, extra.age_range, prompt);
    }
  } else {
    prompt = getEffectivePrompt('prompt_travel_full', DEFAULT_FULL_PROMPT, scenePrompt);
  }

  // tryon: 固定 1920x2560（竖版高清），配合 URL 传图效果最佳
  const outputSize = category === 'tryon' ? '1920x2560' : await calcOutputSize(templateFile);

  console.log(`[Ark] Prompt (${hasFaceCrop ? '3-image' : '2-image'}): ${prompt.substring(0, 100)}...`);

  // 统一: image 1=用户, image 2=模板, (image 3=用户脸部特写)
  const result = await callArkApi(
    imageInputs,
    prompt,
    outputSize,
  );

  if (result.error) {
    return { success: false, error: `${result.error.code}: ${result.error.message}` };
  }

  if (result.data && result.data.length > 0 && result.data[0].url) {
    console.log(`[Ark] Generated successfully, url=${result.data[0].url.substring(0, 80)}...`);
    return { success: true, imageUrl: result.data[0].url };
  }

  return { success: false, error: '未获取到生成结果' };
}

// 主入口
export async function generateTravelPhoto(
  templatePath: string,
  userPhotoPath: string,
  category: string = 'travel',
  extra: { body_type?: string; age_range?: string; scene_prompt?: string; template_image_url?: string } = {},
): Promise<GenerateResult> {
  const templateFile = path.join(config.paths.templates, templatePath);
  const userFile = path.join(config.paths.uploads, userPhotoPath);

  if (!fs.existsSync(templateFile)) {
    return { success: false, error: '模板文件不存在' };
  }
  if (!fs.existsSync(userFile)) {
    return { success: false, error: '用户照片不存在' };
  }

  console.log(`[Ark] Generating photo, template=${templatePath}, user=${userPhotoPath}, category=${category}`);

  try {
    // 旅拍：优先用裁剪-换脸-贴回方案（保留模板发型/衣服/背景）
    if (category === 'travel') {
      console.log('[Ark] Travel mode: trying crop-swap-paste strategy');
      // 模板脸：适中 padding 保留周围区域用于融合
      // 用户脸：较小 padding，聚焦脸部特征，减少头发等干扰
      const [tplBox, userBox] = await Promise.all([
        detectFaceBox(templateFile, 0.2, 0.15, 0.2, 0.2),
        detectFaceBox(userFile, 0.15, 0.15, 0.15, 0.15),
      ]);

      if (tplBox && userBox) {
        console.log('[Ark] Both faces detected, using crop-swap-paste');
        const result = await cropSwapPasteBack(templateFile, userFile, tplBox, userBox, extra.scene_prompt);
        if (result.success) return result;
        console.log('[Ark] Crop-swap-paste failed, falling back to full-image swap');
      } else {
        console.log(`[Ark] Face detection failed (tpl=${!!tplBox}, user=${!!userBox}), falling back to full-image swap`);
      }
    }

    // 试衣 或 旅拍 fallback：全图方案
    return await fullImageSwap(templateFile, userFile, category, { ...extra, template_image_url: extra.template_image_url }, extra.scene_prompt);
  } catch (err: any) {
    console.error('[Ark] Error:', err.message);
    return { success: false, error: '请求失败: ' + err.message };
  }
}
