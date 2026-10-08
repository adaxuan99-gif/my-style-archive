"use client";
import { useState } from "react";
import {
  Archive,
  Download,
  Upload,
  ShieldCheck,
  Smartphone,
  LogOut,
  Plus,
  Trash2,
} from "lucide-react";
import { createBackup, readBackup, restoreBackup } from "@/lib/backup";
import { garmentsCSV, type Garment } from "@/lib/model";
import { saveFile } from "@/lib/images";
import { supabase, friendlyError } from "@/lib/supabase";
import { cleanupOrphans } from "@/lib/repository";
export default function Settings({
  userId,
  email,
  items,
  customCategories,
  refresh,
  notify,
}: {
  userId?: string;
  email?: string;
  items: Garment[];
  customCategories: string[];
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [category, setCategory] = useState("");
  const [backup, setBackup] =
    useState<Awaited<ReturnType<typeof readBackup>>>();
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  return (
    <section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">YOUR ARCHIVE</p>
          <h1>
            我的<span className="title-dot">.</span>
          </h1>
          <p className="muted">你的衣柜，由你保管。</p>
        </div>
      </div>
      <div className="account-card">
        <div className="avatar">M</div>
        <div>
          <strong>我的私人衣橱</strong>
          <p className="caption">{email ?? "尚未连接云端"}</p>
        </div>
        <ShieldCheck />
      </div>
      <div className="stats">
        <div>
          <b>{items.filter((g) => !g.data.archived).length}</b>
          <span>在衣柜中</span>
        </div>
        <div>
          <b>{items.filter((g) => g.data.idle && !g.data.archived).length}</b>
          <span>标记闲置</span>
        </div>
        <div>
          <b>{items.filter((g) => g.data.archived).length}</b>
          <span>已归档</span>
        </div>
      </div>
      <div className="settings-panel">
        <h2>
          <Archive size={20} />
          备份与恢复
        </h2>
        <p className="muted">
          完整备份包含衣服资料、照片、自定义分类和风格档案。建议每月一次，录入较多衣服后再备份一次。
        </p>
        <fieldset disabled={!userId || busy}>
          <button
            className="primary full"
            onClick={() =>
              run(async () => {
                const file = await createBackup(setProgress);
                saveFile(
                  file,
                  `我的AI衣橱-${new Date().toISOString().slice(0, 10)}.zip`,
                );
                notify("备份已生成，请确认保存到“文件”中。");
              })
            }
          >
            <Download size={18} />
            下载完整 ZIP 备份
          </button>
          <div className="row">
            <button
              className="button"
              onClick={() =>
                saveFile(
                  new Blob([garmentsCSV(items)], {
                    type: "text/csv;charset=utf-8",
                  }),
                  "衣服清单.csv",
                )
              }
            >
              导出 CSV 清单
            </button>
            <label className="button">
              <Upload size={18} />
              选择备份恢复
              <input
                type="file"
                accept=".zip,application/zip"
                hidden
                disabled={!userId || busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f)
                    void run(async () => {
                      setProgress("检查备份完整性…");
                      setBackup(await readBackup(f));
                    });
                }}
              />
            </label>
          </div>
        </fieldset>
        <small>
          CSV 仅用于查看；恢复需要完整 ZIP。手机单包上限
          180MB，较大衣柜请查看电脑备份说明。
        </small>
        {backup && (
          <div className="notice">
            <strong>备份检查通过</strong>
            <p>
              {backup.archive.garments.length} 件衣服 ·{" "}
              {backup.archive.garments.flatMap((g) => g.photos).length} 张照片
            </p>
            <p>
              新增缺少的衣服；完全相同的记录跳过。内容或编号冲突会取消全部资料导入。已有风格档案保留，备份中的档案仍在
              ZIP 中。
            </p>
            <div className="row">
              <button
                disabled={busy}
                className="primary"
                onClick={() =>
                  run(async () => {
                    if (!userId) return;
                    const n = await restoreBackup(backup, userId, setProgress);
                    setBackup(undefined);
                    await refresh();
                    notify(`恢复成功，新增 ${n} 件衣服。`);
                  })
                }
              >
                确认恢复
              </button>
              <button
                disabled={busy}
                onClick={() => setBackup(undefined)}
                className="button"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="settings-panel">
        <h2>自定义分类</h2>
        <div className="chips">
          {customCategories.length ? (
            customCategories.map((c) => (
              <span className="chip" key={c}>
                {c}
              </span>
            ))
          ) : (
            <p className="caption">
              已有 11 个常用分类，也可以增加自己的分类。
            </p>
          )}
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (!category.trim() || !userId) return;
              const { error } = await supabase()
                .from("categories")
                .insert({ user_id: userId, name: category.trim() });
              if (error) throw error;
              setCategory("");
              await refresh();
              notify("已添加分类");
            });
          }}
        >
          <input
            aria-label="新分类名称"
            placeholder="新分类名称"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            maxLength={50}
            required
            disabled={!userId || busy}
          />
          <button className="button" disabled={!userId || busy}>
            <Plus size={18} />
            添加
          </button>
        </form>
      </div>
      <div className="settings-panel">
        <h2>
          <ShieldCheck size={20} />
          隐私与存储
        </h2>
        <p>
          照片仅在登录后读取。衣服资料保存在独立数据库，退出或换手机不会删除。
        </p>
        <p className="caption">
          备份包含私人资料，请放在自己的安全位置。此版本不缓存私人照片以供离线浏览。
        </p>
        <button
          className="text-button"
          disabled={!userId || busy}
          onClick={() => {
            if (
              confirm(
                "清理超过 24 小时、且没有关联衣服的上传残留照片？正在使用的照片不会被删除。",
              )
            )
              void run(async () => {
                const n = await cleanupOrphans(userId!);
                notify(`已清理 ${n} 个未关联照片文件`);
              });
          }}
        >
          <Trash2 size={16} />
          清理未关联照片
        </button>
      </div>
      <div className="settings-panel">
        <h2>
          <Smartphone size={20} />
          添加到 iPhone 主屏幕
        </h2>
        <p>
          在 Safari
          打开已部署的网址，点击“分享”，选择“添加到主屏幕”。以后就能像应用一样打开衣橱。
        </p>
        <p className="caption">
          需要联网使用。没有接入付费 AI，也不会自动同步 ChatGPT。
        </p>
      </div>
      {busy && (
        <p className="notice" role="status">
          {progress || "处理中…"}
          <progress />
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {userId && (
        <button
          className="button full"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const { error } = await supabase().auth.signOut();
              if (error) throw error;
            })
          }
        >
          <LogOut size={18} />
          退出登录
        </button>
      )}
      <p className="footer-note">MY STYLE ARCHIVE · 第一阶段 v0.1</p>
    </section>
  );
}
