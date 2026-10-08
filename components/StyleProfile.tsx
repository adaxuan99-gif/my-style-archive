"use client";
import { useEffect, useState } from "react";
import { Sparkles, Save } from "lucide-react";
import { initialProfile, type Profile } from "@/lib/model";
import { loadProfile, saveProfile } from "@/lib/repository";
import { friendlyError } from "@/lib/supabase";
export default function StyleProfile({
  enabled,
  notify,
}: {
  enabled: boolean;
  notify: (s: string) => void;
}) {
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (enabled)
      loadProfile()
        .then((p) => {
          setProfile(p.data ?? initialProfile);
          setVersion(p.version);
        })
        .catch((e) => setError(friendlyError(e)))
        .finally(() => setLoading(false));
  }, [enabled]);
  return (
    <section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">STYLE NOTES</p>
          <h1>
            风格档案<span className="title-dot">.</span>
          </h1>
          <p className="muted">记录此刻的喜欢，也给变化留一点空间。</p>
        </div>
        <Sparkles className="heading-icon" />
      </div>
      <div className="profile-intro">
        <span className="tiny-label">我的风格坐标</span>
        <p>
          有辨识度的日常。
          <br />
          <strong>穿得像自己。</strong>
        </p>
        <span>偏好可以变化，不是永久规则。</span>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await saveProfile(profile, version);
            setVersion((v) => v + 1);
            notify("风格档案已保存");
          } catch (e) {
            setError(friendlyError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset
          disabled={!enabled || loading || busy}
          className="profile-form"
        >
          <label>
            身高（cm）
            <input
              type="number"
              min="50"
              max="250"
              value={profile.height ?? ""}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  height: e.target.value ? +e.target.value : null,
                })
              }
            />
          </label>
          {(
            [
              ["likes", "我喜欢的元素"],
              ["dislikes", "我不喜欢的"],
              ["colors", "颜色偏好"],
              ["shoes", "鞋履习惯与限制"],
              ["principles", "购物与评价原则"],
              ["notes", "留给自己的话"],
            ] as const
          ).map(([key, label], i) => (
            <label key={key}>
              <span className="profile-label">
                <small>0{i + 1}</small>
                {label}
              </span>
              <textarea
                rows={key === "likes" ? 4 : 3}
                maxLength={
                  key === "colors" ? 1000 : key === "shoes" ? 2000 : 5000
                }
                value={profile[key]}
                onChange={(e) =>
                  setProfile({ ...profile, [key]: e.target.value })
                }
              />
            </label>
          ))}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" type="submit">
            <Save size={18} />
            {busy ? "保存中…" : "保存风格档案"}
          </button>
        </fieldset>
      </form>
      {!enabled && (
        <p className="notice">
          以上是你提供的初始偏好，连接并登录后才能修改保存。
        </p>
      )}
    </section>
  );
}
