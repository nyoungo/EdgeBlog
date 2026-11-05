/**
 * 从视频抽取首帧作为封面图。
 *
 * 上传视频时浏览器已经持有完整文件，直接解码抽帧既不需要服务端转码，也不会产生
 * 跨域问题；生成的 JPEG 会作为 multipart 的第二段随视频一起上传。
 */

const LOAD_TIMEOUT_MS = 8000;
const SEEK_TIMEOUT_MS = 5000;

export interface ThumbnailOptions {
  /** 抽帧位置（秒）；默认 0，即视频第一帧。 */
  at?: number;
  /** 输出图最大宽度，默认 1280。 */
  maxWidth?: number;
  /** JPEG 质量，默认 0.82。 */
  quality?: number;
}

function waitForEvent(
  target: HTMLVideoElement,
  event: 'loadedmetadata' | 'loadeddata' | 'seeked',
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('timeout'));
    }, timeoutMs);
    const onDone = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('video error'));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      target.removeEventListener(event, onDone);
      target.removeEventListener('error', onError);
    };
    target.addEventListener(event, onDone);
    target.addEventListener('error', onError);
  });
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * 抽帧并返回 JPEG 文件；浏览器不支持解码该视频、跨域限制或超时时返回 null，
 * 调用方应把 null 当作「没有封面」而不是上传失败。
 */
export async function captureVideoThumbnail(
  source: File | string,
  options: ThumbnailOptions = {},
): Promise<File | null> {
  const objectUrl = typeof source === 'string' ? null : URL.createObjectURL(source);
  const src = typeof source === 'string' ? source : (objectUrl as string);

  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  // 同源视频不受影响；跨域视频只有返回 CORS 头时才能读取像素。
  video.crossOrigin = 'anonymous';
  video.src = src;

  try {
    await waitForEvent(video, 'loadedmetadata', LOAD_TIMEOUT_MS);

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    // 取第一帧：currentTime 默认就是 0，不需要 seek。
    const at = Math.max(0, Math.min(options.at ?? 0, Math.max(0, duration - 0.05)));
    if (at > 0.001) {
      // 先挂监听再改 currentTime，避免极短的视频在赋值瞬间就完成 seek。
      const seeked = waitForEvent(video, 'seeked', SEEK_TIMEOUT_MS);
      video.currentTime = at;
      await seeked;
    }

    // 首帧数据还没解码完时 drawImage 会得到黑图，等一拍再画。
    if (video.readyState < 2) {
      await waitForEvent(video, 'loadeddata', SEEK_TIMEOUT_MS);
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;

    const scale = Math.min(1, (options.maxWidth ?? 1280) / width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // JPEG 没有透明通道，先铺白底避免透明像素变黑。
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await encode(canvas, options.quality ?? 0.82);
    if (!blob) return null;
    return new File([blob], 'thumbnail.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return null;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}