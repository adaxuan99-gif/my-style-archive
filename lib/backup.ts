import { unzip, zip, strFromU8, strToU8 } from "fflate";
import { z } from "zod";
import {
  garmentSchema,
  photoSchema,
  profileSchema,
  garmentsCSV,
  type Garment,
} from "./model";
import { supabase } from "./supabase";
import { downloadPhoto, uploadPhoto } from "./repository";
// 分卷上限保护 iPhone 内存。大衣柜应在电脑导出；不会悄悄省略照片。
export const MAX_BACKUP_BYTES = 180 * 1024 * 1024;
export const archiveSchema = z.object({
  format: z.literal("my-style-archive"),
  version: z.literal(1),
  exported_at: z.string(),
  garments: z
    .array(garmentSchema.extend({ photos: z.array(photoSchema).max(12) }))
    .max(20000),
  profile: profileSchema.nullable(),
  categories: z.array(z.string().min(1).max(50)).max(200),
  counters: z.array(
    z.object({
      prefix: z.string().regex(/^[A-Z]{1,3}$/),
      last_value: z.number().int().positive().max(9999999999),
    }),
  ),
  hashes: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)).optional(),
});
export type Archive = z.infer<typeof archiveSchema>;
async function sha(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function validateArchive(value: unknown) {
  const data = archiveSchema.parse(value);
  const ids = new Set<string>(),
    codes = new Set<string>(),
    photos = new Set<string>();
  for (const g of data.garments) {
    if (ids.has(g.id) || codes.has(g.code))
      throw new Error("备份中有重复衣服或编号。");
    ids.add(g.id);
    codes.add(g.code);
    g.photos.forEach((p, i) => {
      if (photos.has(p.id) || p.position !== i)
        throw new Error("备份中的照片重复或排序损坏。");
      photos.add(p.id);
    });
  }
  return data;
}
export async function createBackup(progress: (s: string) => void) {
  progress("读取完整衣柜快照…");
  const { data, error } = await supabase().rpc("export_archive");
  if (error) throw error;
  const archive = validateArchive(data);
  const total = archive.garments
    .flatMap((g) => g.photos)
    .reduce((s, p) => s + p.size, 0);
  if (total > MAX_BACKUP_BYTES)
    throw new Error(
      "照片超过单包 180MB 安全上限。本版请使用说明中的电脑管理员备份流程，不能只导出部分照片。",
    );
  const files: Record<string, Uint8Array> = {};
  archive.hashes = {};
  let count = 0;
  let actualBytes = 0;
  const photos = archive.garments.flatMap((g) => g.photos);
  for (const p of photos) {
    progress(`下载照片 ${++count} / ${photos.length}`);
    const blob = await downloadPhoto(p.path);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    actualBytes += bytes.length;
    if (actualBytes > MAX_BACKUP_BYTES)
      throw new Error("实际照片大小超过安全上限。");
    const name = `photos/${p.id}.jpg`;
    files[name] = bytes;
    archive.hashes[name] = await sha(bytes);
  }
  files["archive.json"] = strToU8(JSON.stringify(archive, null, 2));
  files["garments.csv"] = strToU8(garmentsCSV(archive.garments as Garment[]));
  files["说明.txt"] = strToU8(
    "我的AI衣橱备份 v1\narchive.json 是完整资料；photos 是照片；garments.csv 便于查看。恢复请上传整个 ZIP，不要改名或删掉照片。备份包含私人信息，请保存在自己的安全位置。",
  );
  progress("打包中…");
  const bytes = await new Promise<Uint8Array>((resolve, reject) =>
    zip(files, { level: 0 }, (e, d) => (e ? reject(e) : resolve(d))),
  );
  return new Blob([new Uint8Array(bytes).buffer], { type: "application/zip" });
}
export async function readBackup(file: File) {
  if (file.size > MAX_BACKUP_BYTES + 15 * 1024 * 1024)
    throw new Error("备份包过大，手机无法安全恢复，请使用电脑管理员备份流程。");
  // 解压前读取中央目录尺寸，由 fflate filter 在分配解压内存前限制展开总量。
  let size = 0;
  let rejected = false;
  const files = await new Promise<Record<string, Uint8Array>>(
    async (resolve, reject) => {
      try {
        unzip(
          new Uint8Array(await file.arrayBuffer()),
          {
            filter: (f) => {
              size += f.originalSize;
              if (
                size > MAX_BACKUP_BYTES + 15 * 1024 * 1024 ||
                f.name.includes("..") ||
                f.name.startsWith("/") ||
                f.originalSize > 15 * 1024 * 1024
              ) {
                rejected = true;
                return false;
              }
              return true;
            },
          },
          (e, d) => (e ? reject(e) : resolve(d)),
        );
      } catch (e) {
        reject(e);
      }
    },
  );
  if (rejected) throw new Error("备份包大小或路径不符合安全限制。");
  if (!files["archive.json"])
    throw new Error("没有找到 archive.json，请选择本应用导出的 ZIP。");
  const archive = validateArchive(JSON.parse(strFromU8(files["archive.json"])));
  for (const p of archive.garments.flatMap((g) => g.photos)) {
    const name = `photos/${p.id}.jpg`,
      bytes = files[name];
    if (!bytes) throw new Error(`备份缺少照片 ${p.id}，未开始恢复。`);
    if (
      bytes.length !== p.size ||
      bytes[0] !== 255 ||
      bytes[1] !== 216 ||
      bytes[2] !== 255
    )
      throw new Error("照片大小或格式校验失败。");
    if (!archive.hashes?.[name] || (await sha(bytes)) !== archive.hashes[name])
      throw new Error("照片校验失败，备份可能损坏。");
  }
  return { archive, files };
}
export async function restoreBackup(
  backup: Awaited<ReturnType<typeof readBackup>>,
  userId: string,
  progress: (s: string) => void,
) {
  const { archive, files } = backup;
  let index = 0;
  const photos = archive.garments.flatMap((g) => g.photos);
  for (const p of photos) {
    progress(`恢复照片 ${++index} / ${photos.length}`);
    const bytes = files[`photos/${p.id}.jpg`];
    const path = `${userId}/${p.id}.jpg`;
    try {
      await uploadPhoto(
        userId,
        p.id,
        new Blob([new Uint8Array(bytes).buffer], { type: "image/jpeg" }),
      );
    } catch (error) {
      // 只允许相同内容的已存在文件，不能覆盖。
      try {
        const existing = await downloadPhoto(path);
        if (
          (await sha(new Uint8Array(await existing.arrayBuffer()))) !==
          (await sha(bytes))
        )
          throw new Error("同名照片内容冲突，恢复已停止。");
      } catch (check) {
        if (check instanceof Error && check.message.includes("冲突"))
          throw check;
        throw error;
      }
    }
  }
  progress("提交资料…");
  const { data, error } = await supabase().rpc("restore_archive", {
    p_archive: archive,
  });
  if (error) throw error;
  return data as number;
}
