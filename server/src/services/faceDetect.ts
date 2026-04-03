import path from 'path';
import sharp from 'sharp';
import * as faceapi from '@vladmandic/face-api';
import * as tf from '@tensorflow/tfjs-node';

const MODEL_PATH = path.join(__dirname, '../../node_modules/@vladmandic/face-api/model');

export interface FaceBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

// 默认 padding
const PAD_TOP = 0.3;
const PAD_BOTTOM = 0.4;
const PAD_LEFT = 0.3;
const PAD_RIGHT = 0.3;

let modelsLoaded = false;

// 启动时加载模型（只需一次）
export async function loadModels(): Promise<void> {
  if (modelsLoaded) return;
  console.log('[FaceDetect] Loading SSD MobileNet model...');
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_PATH);
  modelsLoaded = true;
  console.log('[FaceDetect] Model loaded');
}

// 人脸检测用的最大尺寸（缩小后检测，节省内存）
const DETECT_MAX_DIM = 1024;

// 检测人脸并返回带 padding 的区域坐标（基于原图尺寸）
export async function detectFaceBox(
  filePath: string,
  padTop = PAD_TOP,
  padBottom = PAD_BOTTOM,
  padLeft = PAD_LEFT,
  padRight = PAD_RIGHT,
): Promise<FaceBox | null> {
  if (!modelsLoaded) {
    console.warn('[FaceDetect] Models not loaded, skipping face detection');
    return null;
  }

  try {
    const metadata = await sharp(filePath).metadata();
    const imgWidth = metadata.width!;
    const imgHeight = metadata.height!;

    // 缩小图片再检测，避免大图 OOM
    const scale = Math.min(1, DETECT_MAX_DIM / Math.max(imgWidth, imgHeight));
    const detectW = Math.round(imgWidth * scale);
    const detectH = Math.round(imgHeight * scale);

    const imgBuffer = await sharp(filePath)
      .resize(detectW, detectH, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer();

    console.log(`[FaceDetect] Detecting on ${detectW}x${detectH} (scale=${scale.toFixed(2)}, original=${imgWidth}x${imgHeight})`);

    const tensor = tf.tensor3d(imgBuffer, [detectH, detectW, 3]);

    const detections = await faceapi.detectAllFaces(
      tensor as any,
      new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }),
    );

    tensor.dispose();

    if (detections.length === 0) {
      console.log('[FaceDetect] No face detected');
      return null;
    }

    const largest = detections.reduce((a, b) =>
      a.box.area > b.box.area ? a : b,
    );

    // 把坐标放大回原图尺寸
    const box = largest.box;
    const ox = box.x / scale;
    const oy = box.y / scale;
    const ow = box.width / scale;
    const oh = box.height / scale;

    console.log(`[FaceDetect] Face found: x=${ox.toFixed(0)}, y=${oy.toFixed(0)}, w=${ow.toFixed(0)}, h=${oh.toFixed(0)}, confidence=${largest.score.toFixed(2)}`);

    const left = Math.max(0, Math.floor(ox - ow * padLeft));
    const top = Math.max(0, Math.floor(oy - oh * padTop));
    const right = Math.min(imgWidth, Math.ceil(ox + ow + ow * padRight));
    const bottom = Math.min(imgHeight, Math.ceil(oy + oh + oh * padBottom));

    const cropWidth = right - left;
    const cropHeight = bottom - top;

    if (cropWidth < 100 || cropHeight < 100) {
      console.log('[FaceDetect] Crop area too small, skipping');
      return null;
    }

    console.log(`[FaceDetect] FaceBox: ${left},${top} ${cropWidth}x${cropHeight} (from ${imgWidth}x${imgHeight})`);
    return { left, top, width: cropWidth, height: cropHeight };
  } catch (err: any) {
    console.error('[FaceDetect] Error:', err.message);
    return null;
  }
}

// 检测人脸并裁剪出人脸区域（带 padding）
// 返回裁剪后的 JPEG Buffer，检测失败返回 null
export async function detectAndCrop(filePath: string): Promise<Buffer | null> {
  const box = await detectFaceBox(filePath);
  if (!box) return null;

  try {
    const croppedBuffer = await sharp(filePath)
      .extract(box)
      .jpeg({ quality: 90 })
      .toBuffer();

    console.log(`[FaceDetect] Cropped: ${box.width}x${box.height}, ${croppedBuffer.length} bytes`);
    return croppedBuffer;
  } catch (err: any) {
    console.error('[FaceDetect] Crop error:', err.message);
    return null;
  }
}
