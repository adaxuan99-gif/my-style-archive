"use client";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Camera, ImagePlus, Star, Scissors, Trash2 } from "lucide-react";
import Modal from "./Modal";
import Cropper from "./Cropper";
import PhotoView from "./Photo";
import {
  emptyGarment,
  garmentDataSchema,
  SEASONS,
  STATUSES,
  type Garment,
  type GarmentData,
  type Photo,
} from "@/lib/model";
import { compressImage } from "@/lib/images";
import {
  downloadPhoto,
  uploadPhoto,
  saveGarment,
  removeFiles,
} from "@/lib/repository";
import { friendlyError } from "@/lib/supabase";
type DraftPhoto = Photo & { blob?: Blob; url?: string };
export default function GarmentEditor({
  garment,
  userId,
  categories,
  onClose,
  onSaved,
}: {
  garment?: Garment;
  userId: string;
  categories: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [data, setData] = useState<GarmentData>(
    garment?.data ?? { ...emptyGarment },
  );
  const [photos, setPhotos] = useState<DraftPhoto[]>(garment?.photos ?? []);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [crop, setCrop] = useState<{ id: string; blob: Blob }>();
  const urls = useRef<string[]>([]);
  const id = useRef(garment?.id ?? crypto.randomUUID());
  useEffect(() => () => urls.current.forEach(URL.revokeObjectURL), []);
  const change = <K extends keyof GarmentData>(key: K, value: GarmentData[K]) =>
    setData((d) => ({ ...d, [key]: value }));
  function localPhoto(
    result: { blob: Blob; width: number; height: number },
    photoId = crypto.randomUUID(),
  ): DraftPhoto {
    const url = URL.createObjectURL(result.blob);
    urls.current.push(url);
    return {
      id: photoId,
      path: "",
      size: result.blob.size,
      width: result.width,
      height: result.height,
      position: 0,
      blob: result.blob,
      url,
    };
  }
  async function addPhotos(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (photos.length + files.length > 12) {
      setError("单件衣服最多保存 12 张照片。");
      return;
    }
    setBusy(true);
    setError("");
    const added: DraftPhoto[] = [];
    const failures: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        setProgress(`处理照片 ${i + 1} / ${files.length}`);
        try {
          // 逐张处理，避免同时解码多张 iPhone 原图；失败的照片不阻断其他照片。
          added.push(localPhoto(await compressImage(files[i])));
        } catch (error) {
          failures.push(`${i + 1}: ${friendlyError(error)}`);
        }
      }
      setPhotos((p) => [...p, ...added]);
      if (failures.length)
        setError(
          `有 ${failures.length} 张照片未处理，其他照片仍可继续上传：\n${failures.join("\n")}`,
        );
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  async function save() {
    setError("");
    const valid = garmentDataSchema.safeParse(data);
    if (!valid.success) {
      setError(valid.error.issues[0].message);
      return;
    }
    setBusy(true);
    const uploaded: string[] = [];
    let committed = false;
    try {
      const final: Photo[] = [];
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        setProgress(`保存照片 ${i + 1} / ${photos.length}`);
        const path = p.blob ? await uploadPhoto(userId, p.id, p.blob) : p.path;
        if (p.blob) uploaded.push(path);
        final.push({
          id: p.id,
          path,
          size: p.size,
          width: p.width,
          height: p.height,
          position: i,
        });
      }
      setProgress("保存衣服资料…");
      await saveGarment(id.current, valid.data, final, garment?.version ?? 0);
      committed = true;
      let message = "已保存到衣柜";
      try {
        await removeFiles(
          (garment?.photos ?? [])
            .filter((p) => !final.some((f) => f.path === p.path))
            .map((p) => p.path),
        );
      } catch {
        message = "资料已保存；旧照片暂未清理，可稍后在“我的”清理。";
      }
      onSaved(message);
    } catch (e) {
      if (!committed)
        try {
          await removeFiles(uploaded);
        } catch {
          /* 孤立文件可在我的中清理；已关联文件受 RLS 保护。 */
        }
      setError(friendlyError(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  const close = () => {
    if (busy) return;
    if (confirm("退出编辑？尚未保存的修改会丢失。")) onClose();
  };
  return (
    <Modal
      title={garment ? `编辑 ${garment.code}` : "收录一件衣服"}
      onClose={close}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy} className="editor-fieldset">
          <div className="modal-body">
            <p className="muted">先留下一张照片，其他细节可以慢慢补充。</p>
            <div className="photo-strip">
              {photos.map((p, i) => (
                <div key={p.id} className="draft-photo">
                  {p.url ? (
                    <img src={p.url} alt={`照片 ${i + 1}`} />
                  ) : (
                    <PhotoView path={p.path} alt={`照片 ${i + 1}`} />
                  )}
                  <span className="cover-tag">{i === 0 ? "封面" : i + 1}</span>
                  <div className="photo-actions">
                    <button
                      type="button"
                      aria-label={`设照片 ${i + 1} 为封面`}
                      onClick={() =>
                        setPhotos([p, ...photos.filter((x) => x.id !== p.id)])
                      }
                    >
                      <Star size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label={`裁剪照片 ${i + 1}`}
                      onClick={async () => {
                        try {
                          setCrop({
                            id: p.id,
                            blob: p.blob ?? (await downloadPhoto(p.path)),
                          });
                        } catch (e) {
                          setError(friendlyError(e));
                        }
                      }}
                    >
                      <Scissors size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label={`移除照片 ${i + 1}`}
                      onClick={() => {
                        if (confirm("从这件衣服中移除照片？保存后生效。"))
                          setPhotos(photos.filter((x) => x.id !== p.id));
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="upload-buttons">
              <label className="button">
                <Camera size={18} />
                拍照
                <input
                  aria-label="拍照上传"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={addPhotos}
                  hidden
                  disabled={busy}
                />
              </label>
              <label className="button">
                <ImagePlus size={18} />
                从相册选图
                <input
                  aria-label="从相册上传照片"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  multiple
                  onChange={addPhotos}
                  hidden
                  disabled={busy}
                />
              </label>
            </div>
            <p className="caption">最多 12 张 · 自动压缩 · 第一张为封面</p>
            <div className="form-grid">
              <label className="span-2">
                名称 <span className="required">*</span>
                <input
                  value={data.name}
                  onChange={(e) => change("name", e.target.value)}
                  placeholder="例如：做旧蓝色阔腿牛仔裤"
                  required
                  maxLength={100}
                />
              </label>
              <label>
                分类
                <select
                  value={data.category}
                  onChange={(e) => change("category", e.target.value)}
                >
                  {Array.from(new Set([...categories, data.category])).map(
                    (c) => (
                      <option key={c}>{c}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                二级分类
                <input
                  value={data.subcategory}
                  onChange={(e) => change("subcategory", e.target.value)}
                  placeholder="牛仔裤、工装裤…"
                  maxLength={200}
                />
              </label>
              <label>
                颜色
                <input
                  value={data.color}
                  onChange={(e) => change("color", e.target.value)}
                  placeholder="蓝色"
                  maxLength={200}
                />
              </label>
              <label>
                版型
                <input
                  value={data.fit}
                  onChange={(e) => change("fit", e.target.value)}
                  placeholder="阔腿、宽松…"
                  maxLength={200}
                />
              </label>
              <div className="span-2">
                <p className="field-title">适合季节</p>
                <div className="chips">
                  {SEASONS.map((s) => (
                    <button
                      type="button"
                      key={s}
                      className={
                        data.seasons.includes(s) ? "chip selected" : "chip"
                      }
                      aria-pressed={data.seasons.includes(s)}
                      onClick={() =>
                        change(
                          "seasons",
                          data.seasons.includes(s)
                            ? data.seasons.filter((x) => x !== s)
                            : [...data.seasons, s],
                        )
                      }
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <label className="span-2">
                风格标签
                <input
                  value={data.tags.join("，")}
                  onChange={(e) =>
                    change(
                      "tags",
                      e.target.value.split(/[,，]/).map((s) => s.trim()),
                    )
                  }
                  placeholder="做旧，街头，少年感"
                  maxLength={1000}
                />
                <small>用逗号分隔多个标签</small>
              </label>
              <label>
                穿着状态
                <select
                  value={data.status}
                  onChange={(e) =>
                    change("status", e.target.value as GarmentData["status"])
                  }
                >
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                喜欢程度
                <select
                  value={data.rating}
                  onChange={(e) => change("rating", +e.target.value)}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} / 5
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <details className="more-fields">
              <summary>补充购买信息与其他细节</summary>
              <div className="form-grid">
                {(
                  [
                    ["brand", "品牌"],
                    ["size", "尺码"],
                    ["material", "材质"],
                    ["thickness", "厚度"],
                    ["channel", "购买渠道"],
                    ["frequency", "穿着频率（手动备注）"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k}>
                    {label}
                    <input
                      value={data[k]}
                      onChange={(e) => change(k, e.target.value)}
                      maxLength={200}
                    />
                  </label>
                ))}
                <label>
                  购买价格（元）
                  <input
                    type="number"
                    min="0"
                    max="10000000"
                    step="0.01"
                    value={data.price ?? ""}
                    onChange={(e) =>
                      change(
                        "price",
                        e.target.value === "" ? null : +e.target.value,
                      )
                    }
                  />
                </label>
                <label>
                  购买日期
                  <input
                    type="date"
                    value={data.purchase_date}
                    onChange={(e) => change("purchase_date", e.target.value)}
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={data.idle}
                    onChange={(e) => change("idle", e.target.checked)}
                  />
                  目前闲置
                </label>
              </div>
            </details>
            <label>
              备注
              <textarea
                rows={3}
                value={data.notes}
                onChange={(e) => change("notes", e.target.value)}
                placeholder="喜欢哪里？搭配时有什么想法？"
                maxLength={5000}
              />
            </label>
          </div>
        </fieldset>
        <div className="modal-foot">
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {busy && <p role="status">{progress}</p>}
          <button className="primary full" type="submit" disabled={busy}>
            {busy ? "正在保存…" : "保存到我的衣柜"}
          </button>
        </div>
      </form>
      {crop && (
        <Cropper
          blob={crop.blob}
          onClose={() => setCrop(undefined)}
          onDone={(r) => {
            setPhotos((p) =>
              p.map((x) => (x.id === crop.id ? localPhoto(r) : x)),
            );
            setCrop(undefined);
          }}
        />
      )}
    </Modal>
  );
}
