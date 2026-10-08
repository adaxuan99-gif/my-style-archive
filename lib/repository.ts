import { supabase } from "./supabase";
import {
  garmentDataSchema,
  profileSchema,
  type Garment,
  type GarmentData,
  type Photo,
  type Profile,
} from "./model";
export const BUCKET = "wardrobe";
export async function loadWardrobe(): Promise<Garment[]> {
  const client = supabase();
  let rows: Garment[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client
      .from("garments")
      .select("*,photos(*)")
      .order("created_at", { ascending: false })
      .order("id")
      .range(offset, offset + 499);
    if (error) throw error;
    rows = rows.concat(data as Garment[]);
    if (data.length < 500) break;
  }
  return rows.map((g) => ({
    ...g,
    photos: g.photos.sort((a, b) => a.position - b.position),
  }));
}
export async function downloadPhoto(path: string) {
  const { data, error } = await supabase().storage.from(BUCKET).download(path);
  if (error) throw error;
  return data;
}
export async function uploadPhoto(userId: string, id: string, blob: Blob) {
  const path = `${userId}/${id}.jpg`;
  const { error } = await supabase()
    .storage.from(BUCKET)
    .upload(path, blob, {
      contentType: "image/jpeg",
      upsert: false,
      cacheControl: "0",
    });
  if (error) throw error;
  return path;
}
export async function removeFiles(paths: string[]) {
  if (!paths.length) return;
  const { error } = await supabase().storage.from(BUCKET).remove(paths);
  if (error) throw error;
}
export async function saveGarment(
  id: string,
  data: GarmentData,
  photos: Photo[],
  version: number,
) {
  const { error } = await supabase().rpc("save_garment", {
    p_id: id,
    p_data: garmentDataSchema.parse(data),
    p_photos: photos.map((p, i) => ({ ...p, position: i })),
    p_version: version,
  });
  if (error) throw error;
}
export async function deleteGarments(items: Garment[]) {
  const { error } = await supabase().rpc("delete_garments", {
    p_ids: items.map((g) => g.id),
  });
  if (error) throw error;
  try {
    await removeFiles(items.flatMap((g) => g.photos.map((p) => p.path)));
    return "";
  } catch {
    return "衣服资料已删除，但部分照片清理失败。请在“我的”清理未关联照片。";
  }
}
export async function loadProfile(): Promise<{
  data: Profile | null;
  version: number;
}> {
  const { data, error } = await supabase()
    .from("profiles")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return { data: data?.data ?? null, version: data?.version ?? 0 };
}
export async function saveProfile(data: Profile, version: number) {
  const { error } = await supabase().rpc("save_profile", {
    p_data: profileSchema.parse(data),
    p_version: version,
  });
  if (error) throw error;
}
export async function loadCategories() {
  const { data, error } = await supabase().from("categories").select("name");
  if (error) throw error;
  return data.map((x) => x.name as string);
}
export async function cleanupOrphans(userId: string) {
  const items = await loadWardrobe();
  const used = new Set(items.flatMap((g) => g.photos.map((p) => p.path)));
  const files: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase()
      .storage.from(BUCKET)
      .list(userId, {
        limit: 100,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
    if (error) throw error;
    files.push(
      ...data
        .filter(
          (f) =>
            f.id &&
            !used.has(`${userId}/${f.name}`) &&
            Date.now() - Date.parse(f.created_at ?? new Date().toISOString()) >
              24 * 3600 * 1000,
        )
        .map((f) => `${userId}/${f.name}`),
    );
    if (data.length < 100) break;
  }
  for (let i = 0; i < files.length; i += 100)
    await removeFiles(files.slice(i, i + 100));
  return files.length;
}
