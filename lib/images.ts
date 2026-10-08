export const MAX_INPUT = 20 * 1024 * 1024;
export async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(
          new Error(
            "无法读取这张图片。HEIC 请先在相册中转换为 JPEG，或使用“兼容性最佳”格式拍照。",
          ),
        );
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function compressImage(
  file: File | Blob,
  crop?: { x: number; y: number; size: number },
) {
  if (file.size > MAX_INPUT) throw new Error("单张原图不能超过 20MB。");
  if (
    ![
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ].includes(file.type)
  )
    throw new Error("请选择 JPEG、PNG、WebP 或可被 Safari 读取的 HEIC 图片。");
  const image = await loadImage(file);
  if (image.naturalWidth * image.naturalHeight > 60000000)
    throw new Error("图片分辨率过大，请先缩小后上传。");
  const sw = crop?.size ?? image.naturalWidth,
    sh = crop?.size ?? image.naturalHeight;
  const ratio = Math.min(1, 1600 / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * ratio);
  canvas.height = Math.round(sh * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器暂不支持照片处理。");
  ctx.fillStyle = "#f5f5f3";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    image,
    crop?.x ?? 0,
    crop?.y ?? 0,
    sw,
    sh,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  let quality = 0.84;
  let blob: Blob;
  do {
    blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("照片压缩失败"))),
        "image/jpeg",
        quality,
      ),
    );
    quality -= 0.12;
  } while (blob.size > 900000 && quality > 0.35);
  if (blob.size > 2 * 1024 * 1024)
    throw new Error("压缩后的照片仍超过 2MB，请先缩小照片。");
  return { blob, width: canvas.width, height: canvas.height };
}
export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
