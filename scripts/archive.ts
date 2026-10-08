/** 电脑大容量备份：每次只处理一张照片，不在内存中打包全部文件。 */
import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { supabase } from "../lib/supabase";
import { validateArchive } from "../lib/backup";
import { downloadPhoto, uploadPhoto } from "../lib/repository";
import { garmentsCSV, type Garment } from "../lib/model";
const [action, directory] = process.argv.slice(2);
const email = process.env.ARCHIVE_EMAIL,
  password = process.env.ARCHIVE_PASSWORD;
if (
  !["export", "restore"].includes(action) ||
  !directory ||
  !email ||
  !password
) {
  console.error(
    "用法：pnpm exec tsx --env-file=.env.local --env-file=.env.backup scripts/archive.ts export|restore 备份目录\n.env.backup 包含 ARCHIVE_EMAIL 和 ARCHIVE_PASSWORD，仅保存在自己的电脑。",
  );
  process.exit(1);
}
const client = supabase();
const { data: auth, error } = await client.auth.signInWithPassword({
  email,
  password,
});
if (error || !auth.user) throw new Error("登录失败，请检查本地账号配置。");
const root = resolve(directory);
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
try {
  if (action === "export") {
    await mkdir(join(root, "photos"), { recursive: true });
    const { data, error } = await client.rpc("export_archive");
    if (error) throw error;
    const archive = validateArchive(data);
    archive.hashes = {};
    let count = 0;
    for (const p of archive.garments.flatMap((g) => g.photos)) {
      const bytes = new Uint8Array(
        await (await downloadPhoto(p.path)).arrayBuffer(),
      );
      if (bytes.length !== p.size)
        throw new Error("照片大小与资料不一致，停止备份。");
      const name = `photos/${p.id}.jpg`;
      await writeFile(join(root, name), bytes);
      archive.hashes[name] = hash(bytes);
      console.log(`已导出照片 ${++count}`);
    }
    await writeFile(
      join(root, "garments.csv"),
      garmentsCSV(archive.garments as Garment[]),
    );
    await writeFile(
      join(root, "archive.json.tmp"),
      JSON.stringify(archive, null, 2),
    );
    await rename(join(root, "archive.json.tmp"), join(root, "archive.json"));
    console.log(
      `完整备份成功：${archive.garments.length} 件衣服。请保留整个目录，可用系统压缩功能另存 ZIP。`,
    );
  } else {
    const archive = validateArchive(
      JSON.parse(await readFile(join(root, "archive.json"), "utf8")),
    );
    // 先校验全部文件，再进行任何云端写入。
    for (const p of archive.garments.flatMap((g) => g.photos)) {
      const name = `photos/${p.id}.jpg`;
      const info = await stat(join(root, name));
      if (!info.isFile() || info.size !== p.size)
        throw new Error(`照片缺失或大小错误：${name}`);
      const bytes = await readFile(join(root, name));
      if (
        bytes[0] !== 255 ||
        bytes[1] !== 216 ||
        bytes[2] !== 255 ||
        hash(bytes) !== archive.hashes?.[name]
      )
        throw new Error(`照片校验失败：${name}`);
    }
    let count = 0;
    for (const p of archive.garments.flatMap((g) => g.photos)) {
      const bytes = await readFile(join(root, `photos/${p.id}.jpg`));
      try {
        await uploadPhoto(
          auth.user.id,
          p.id,
          new Blob([bytes], { type: "image/jpeg" }),
        );
      } catch (error) {
        const existing = new Uint8Array(
          await (
            await downloadPhoto(`${auth.user.id}/${p.id}.jpg`)
          ).arrayBuffer(),
        );
        if (hash(existing) !== hash(bytes)) throw error;
      }
      console.log(`已准备照片 ${++count}`);
    }
    const { data, error } = await client.rpc("restore_archive", {
      p_archive: archive,
    });
    if (error) throw error;
    console.log(
      `恢复完成，新增 ${data} 件衣服。已有档案保留，同内容记录已跳过。`,
    );
  }
} finally {
  await client.auth.signOut();
}
