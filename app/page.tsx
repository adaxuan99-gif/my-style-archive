"use client";
import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Shirt,
  FlaskConical,
  Sparkles,
  BookOpen,
  UserRound,
  Plus,
  Search,
  SlidersHorizontal,
  LayoutGrid,
  List,
  ArrowLeft,
  Archive,
  Trash2,
  Pencil,
  Cloud,
  RefreshCw,
  Check,
  LockKeyhole,
} from "lucide-react";
import { configured, supabase, friendlyError } from "@/lib/supabase";
import {
  CATEGORIES,
  SEASONS,
  emptyGarment,
  filterGarments,
  type Garment,
  type Filters,
} from "@/lib/model";
import {
  loadWardrobe,
  loadCategories,
  saveGarment,
  deleteGarments,
  uploadPhoto,
  removeFiles,
} from "@/lib/repository";
import { compressImage } from "@/lib/images";
import Photo from "@/components/Photo";
import Modal from "@/components/Modal";
import GarmentEditor from "@/components/GarmentEditor";
import StyleProfile from "@/components/StyleProfile";
import Settings from "@/components/Settings";
const tabs = [
  { name: "我的衣柜", icon: Shirt },
  { name: "穿搭实验室", icon: FlaskConical },
  { name: "风格档案", icon: Sparkles },
  { name: "穿搭日记", icon: BookOpen },
  { name: "我的", icon: UserRound },
];
export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [tab, setTab] = useState(0);
  const [items, setItems] = useState<Garment[]>([]);
  const [custom, setCustom] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [setup, setSetup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    query: "",
    category: "",
    color: "",
    season: "",
    tag: "",
    archived: false,
  });
  const [moreFilters, setMoreFilters] = useState(false);
  const [list, setList] = useState(false);
  const [editor, setEditor] = useState<Garment | "new">();
  const [detail, setDetail] = useState<Garment>();
  const [selected, setSelected] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkTags, setBulkTags] = useState("");
  const [batch, setBatch] = useState(false);
  const [batchStatus, setBatchStatus] = useState("");
  const notify = useCallback((s: string) => setToast(s), []);
  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const [rows, categories] = await Promise.all([
        loadWardrobe(),
        loadCategories(),
      ]);
      setItems(rows);
      setCustom(categories);
    } catch (e) {
      setError(friendlyError(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, [session]);
  useEffect(() => {
    if (!configured) return;
    const client = supabase();
    client.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) setError(friendlyError(error));
        setSession(data.session);
        setAuthReady(true);
      })
      .catch((e) => {
        setError(friendlyError(e));
        setAuthReady(true);
      });
    const { data } = client.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setAuthReady(true);
      if (!s) {
        setItems([]);
        setCustom([]);
        setDetail(undefined);
        setEditor(undefined);
        setSelected([]);
        setTab(0);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (session) void refresh().catch(() => {});
  }, [session, refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const offline = () => setError("当前已离线。请联网后继续保存或读取衣柜。");
    window.addEventListener("offline", offline);
    return () => window.removeEventListener("offline", offline);
  }, []);
  const categories = Array.from(
    new Set([...CATEGORIES, ...custom, ...items.map((g) => g.data.category)]),
  );
  const visible = filterGarments(items, filters);
  const active = items.filter((g) => !g.data.archived);
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  async function changeArchive(gs: Garment[], archived: boolean) {
    let done = 0;
    try {
      for (const g of gs) {
        await saveGarment(g.id, { ...g.data, archived }, g.photos, g.version);
        done++;
      }
      notify(archived ? "已归档，可在归档衣柜中找回" : "已移回衣柜");
    } catch (e) {
      throw new Error(`已完成 ${done}/${gs.length} 件。${friendlyError(e)}`);
    } finally {
      setDetail(undefined);
      setSelected([]);
      await refresh();
    }
  }
  const add = () => (session ? setEditor("new") : setSetup(true));
  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <a href="/" className="brand">
            <span className="brand-mark">
              M<span>◦</span>
            </span>
            <span>
              我的AI衣橱<small>MY STYLE ARCHIVE</small>
            </span>
          </a>
          <div className="sidebar-label">PERSONAL COLLECTION</div>
          <nav>
            {tabs.map(({ name, icon: Icon }, i) => (
              <button
                key={name}
                className={tab === i ? "nav-item active" : "nav-item"}
                onClick={() => {
                  setTab(i);
                  setDetail(undefined);
                }}
              >
                <Icon size={21} />
                {name}
                {i === 0 && <small>{active.length}</small>}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="privacy-dot">
              <LockKeyhole size={16} />
              私人风格档案
            </div>
            <p>
              让每一件衣服，
              <br />
              都有属于你的故事。
            </p>
          </div>
        </aside>
        <main className="main">
          <header className="topbar">
            <span className="mobile-brand">我的AI衣橱</span>
            <span className="desktop-top">
              MY STYLE ARCHIVE <span>/</span> {tabs[tab].name}
            </span>
            <span className="cloud-status">
              <Cloud size={15} />
              {session ? "私人云端衣柜" : "待连接"}
            </span>
          </header>
          {!configured && (
            <div className="setup-banner">
              <span>先连接你的私人衣柜，即可永久保存衣服和照片。</span>
              <button onClick={() => setSetup(true)}>配置说明</button>
            </div>
          )}
          {!authReady ? (
            <div className="empty">
              <p>正在确认登录状态…</p>
            </div>
          ) : configured && !session ? (
            <section className="login">
              <p className="eyebrow">A SPACE FOR YOUR STYLE</p>
              <div className="login-symbol">
                <Shirt size={48} strokeWidth={1} />
              </div>
              <h1>
                欢迎回到
                <br />
                你的私人衣橱。
              </h1>
              <p className="muted">衣服的细节、每一次喜欢，都妥善收藏。</p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setLoginBusy(true);
                  setError("");
                  try {
                    const { error } = await supabase().auth.signInWithPassword({
                      email,
                      password,
                    });
                    if (error) throw error;
                    setPassword("");
                  } catch (e) {
                    setError(friendlyError(e));
                  } finally {
                    setLoginBusy(false);
                  }
                }}
              >
                <label>
                  邮箱
                  <input
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label>
                  密码
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <button className="primary full" disabled={loginBusy}>
                  {loginBusy ? "登录中…" : "登录我的衣柜"}
                </button>
              </form>
              <p className="caption">
                私人应用不开放注册。首次使用或忘记密码，请按照部署说明在自己的
                Supabase 控制台管理账号。
              </p>
            </section>
          ) : (
            <div className="page-content">
              {tab === 0 && (
                <>
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">THE WARDROBE EDIT</p>
                      <h1>
                        {filters.archived ? "归档衣柜" : "我的衣柜"}
                        <span className="title-dot">.</span>
                      </h1>
                      <p className="muted">
                        {filters.archived
                          ? "暂时告别的单品，也值得被记住。"
                          : "收藏拥有的，发现新的可能。"}
                      </p>
                    </div>
                    <button
                      className="primary add-button"
                      aria-label="收录衣服"
                      onClick={add}
                    >
                      <Plus size={20} />
                      <span>收录衣服</span>
                    </button>
                  </div>
                  <div className="wardrobe-overview">
                    <div>
                      <span className="tiny-label">IN YOUR COLLECTION</span>
                      <p>
                        <b>{active.length.toString().padStart(2, "0")}</b>
                        <span>件衣服，属于你的风格</span>
                      </p>
                    </div>
                    <div className="overview-note">
                      <span>慢慢收集，好好穿着。</span>
                      <small>从最喜欢的一件开始。</small>
                    </div>
                  </div>
                  <div className="category-tabs">
                    <button
                      className={!filters.category ? "active" : ""}
                      onClick={() => {
                        setFilters({ ...filters, category: "" });
                        setSelected([]);
                      }}
                    >
                      全部{" "}
                      <small>
                        {
                          items.filter(
                            (g) => g.data.archived === filters.archived,
                          ).length
                        }
                      </small>
                    </button>
                    {categories.map((c) => (
                      <button
                        key={c}
                        className={filters.category === c ? "active" : ""}
                        onClick={() => {
                          setFilters({ ...filters, category: c });
                          setSelected([]);
                        }}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <div className="toolbar">
                    <div className="search">
                      <Search size={19} />
                      <input
                        aria-label="搜索衣服"
                        placeholder="搜索名称、编号或标签"
                        value={filters.query}
                        onChange={(e) =>
                          setFilters({ ...filters, query: e.target.value })
                        }
                      />
                    </div>
                    <button
                      className={moreFilters ? "button selected" : "button"}
                      aria-label="筛选"
                      onClick={() => setMoreFilters(!moreFilters)}
                      aria-expanded={moreFilters}
                    >
                      <SlidersHorizontal size={18} />
                      <span>筛选</span>
                    </button>
                    <button
                      className="icon-button view-toggle"
                      aria-label={list ? "切换网格模式" : "切换列表模式"}
                      onClick={() => setList(!list)}
                    >
                      {list ? <LayoutGrid size={20} /> : <List size={20} />}
                    </button>
                  </div>
                  {moreFilters && (
                    <div className="filter-panel">
                      <label>
                        颜色
                        <input
                          placeholder="例如：蓝"
                          value={filters.color}
                          onChange={(e) =>
                            setFilters({ ...filters, color: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        季节
                        <select
                          value={filters.season}
                          onChange={(e) =>
                            setFilters({ ...filters, season: e.target.value })
                          }
                        >
                          <option value="">全部季节</option>
                          {SEASONS.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        风格
                        <input
                          placeholder="例如：复古"
                          value={filters.tag}
                          onChange={(e) =>
                            setFilters({ ...filters, tag: e.target.value })
                          }
                        />
                      </label>
                      <button
                        className="text-button"
                        onClick={() =>
                          setFilters({
                            ...filters,
                            color: "",
                            season: "",
                            tag: "",
                            query: "",
                          })
                        }
                      >
                        清除筛选
                      </button>
                    </div>
                  )}
                  <div className="collection-meta">
                    <span>
                      {visible.length} 件单品 {loading && "· 正在同步"}
                    </span>
                    <div>
                      <button
                        className="text-button"
                        onClick={() => {
                          setFilters({
                            ...filters,
                            archived: !filters.archived,
                          });
                          setSelected([]);
                        }}
                      >
                        <Archive size={15} />
                        {filters.archived ? "返回衣柜" : "已归档"}
                      </button>
                      <button
                        className="text-button"
                        disabled={!session || busy}
                        onClick={() => {
                          setSelectMode(!selectMode);
                          setSelected([]);
                        }}
                      >
                        {selectMode ? "完成" : "批量管理"}
                      </button>
                    </div>
                  </div>
                  {selectMode && (
                    <div className="bulk-panel">
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={
                            visible.length > 0 &&
                            visible.every((g) => selected.includes(g.id))
                          }
                          onChange={(e) =>
                            setSelected(
                              e.target.checked ? visible.map((g) => g.id) : [],
                            )
                          }
                        />
                        选择当前结果（{selected.length}）
                      </label>
                      <div className="row">
                        <select
                          aria-label="批量分类"
                          value={bulkCategory}
                          onChange={(e) => setBulkCategory(e.target.value)}
                        >
                          <option value="">选择分类</option>
                          {categories.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                        <input
                          aria-label="批量标签"
                          placeholder="添加标签，逗号分隔"
                          value={bulkTags}
                          onChange={(e) => setBulkTags(e.target.value)}
                        />
                      </div>
                      <div className="row">
                        <button
                          className="button"
                          disabled={
                            busy ||
                            !selected.length ||
                            (!bulkCategory && !bulkTags.trim())
                          }
                          onClick={() =>
                            perform(async () => {
                              let done = 0;
                              try {
                                for (const g of items.filter((g) =>
                                  selected.includes(g.id),
                                )) {
                                  await saveGarment(
                                    g.id,
                                    {
                                      ...g.data,
                                      category: bulkCategory || g.data.category,
                                      tags: Array.from(
                                        new Set([
                                          ...g.data.tags,
                                          ...bulkTags
                                            .split(/[,，]/)
                                            .map((t) => t.trim())
                                            .filter(Boolean),
                                        ]),
                                      ),
                                    },
                                    g.photos,
                                    g.version,
                                  );
                                  done++;
                                }
                                notify(`已修改 ${done} 件衣服`);
                              } catch (e) {
                                throw new Error(
                                  `已完成 ${done} 件；${friendlyError(e)}`,
                                );
                              } finally {
                                setSelected([]);
                                await refresh();
                              }
                            })
                          }
                        >
                          应用修改
                        </button>
                        <button
                          className="button"
                          disabled={busy || !selected.length}
                          onClick={() =>
                            perform(() =>
                              changeArchive(
                                items.filter((g) => selected.includes(g.id)),
                                !filters.archived,
                              ),
                            )
                          }
                        >
                          {filters.archived ? "移回衣柜" : "归档"}
                        </button>
                        <button
                          className="button danger"
                          disabled={busy || !selected.length}
                          onClick={() => {
                            if (
                              confirm(
                                `永久删除 ${selected.length} 件衣服及照片？此操作不能撤销。建议先下载备份。`,
                              )
                            )
                              void perform(async () => {
                                const warning = await deleteGarments(
                                  items.filter((g) => selected.includes(g.id)),
                                );
                                setSelected([]);
                                await refresh();
                                notify(warning || "已删除所选衣服");
                              });
                          }}
                        >
                          永久删除
                        </button>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => setBatch(true)}
                      >
                        批量收录照片（每张作为一件衣服）
                      </button>
                    </div>
                  )}
                  {!visible.length ? (
                    <div className="empty">
                      <div className="empty-icon">
                        <Shirt size={48} strokeWidth={1.15} />
                        <span>+</span>
                      </div>
                      <p className="eyebrow">ROOM FOR YOUR FAVORITES</p>
                      <h2>
                        {items.length
                          ? "没有找到符合条件的单品"
                          : "你的风格档案，从这里开始"}
                      </h2>
                      <p>
                        {items.length
                          ? "换一个关键词，或者清除筛选再看看。"
                          : "拍下喜欢的衣服，让每一件都不被遗忘。"}
                      </p>
                      {!items.length && (
                        <button className="primary" onClick={add}>
                          <Plus size={18} />
                          收录第一件衣服
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className={list ? "garment-list" : "garment-grid"}>
                      {visible.map((g) => (
                        <button
                          key={g.id}
                          className={`garment-card ${selected.includes(g.id) ? "is-selected" : ""}`}
                          onClick={() =>
                            selectMode
                              ? setSelected(
                                  selected.includes(g.id)
                                    ? selected.filter((x) => x !== g.id)
                                    : [...selected, g.id],
                                )
                              : setDetail(g)
                          }
                        >
                          <div className="card-image">
                            <Photo path={g.photos[0]?.path} alt={g.data.name} />
                            {selectMode && (
                              <span className="selection-check">
                                {selected.includes(g.id) && <Check size={16} />}
                              </span>
                            )}
                            {g.data.idle && (
                              <span className="idle-tag">闲置</span>
                            )}
                          </div>
                          <div className="card-text">
                            <div>
                              <span className="code">{g.code}</span>
                              <span className="caption">{g.data.category}</span>
                            </div>
                            <h3>{g.data.name}</h3>
                            <p>
                              {[g.data.color, ...g.data.tags.slice(0, 2)]
                                .filter(Boolean)
                                .join(" · ") || "等待补充细节"}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="footer-note">
                    只收藏真正拥有的衣服 · 灵感与库存分开记录
                  </p>
                </>
              )}
              {tab === 2 && (
                <StyleProfile enabled={!!session} notify={notify} />
              )}{" "}
              {(tab === 1 || tab === 3) && (
                <section>
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">COMING IN THE NEXT CHAPTER</p>
                      <h1>
                        {tabs[tab].name}
                        <span className="title-dot">.</span>
                      </h1>
                    </div>
                  </div>
                  <div className="empty">
                    {tab === 1 ? (
                      <FlaskConical size={48} strokeWidth={1} />
                    ) : (
                      <BookOpen size={48} strokeWidth={1} />
                    )}
                    <h2>先把喜欢的衣服收进来</h2>
                    <p>
                      {tab === 1
                        ? "第二阶段将支持选择已有单品、组合并保存穿搭。"
                        : "第二阶段将支持每天的实穿记录，并据此统计穿着次数。"}
                    </p>
                    <span className="chip">
                      尚未开放 · 第一阶段优先完善衣柜
                    </span>
                    <button className="button" onClick={() => setTab(0)}>
                      返回我的衣柜
                    </button>
                  </div>
                </section>
              )}
              {tab === 4 && (
                <Settings
                  userId={session?.user.id}
                  email={session?.user.email}
                  items={items}
                  customCategories={custom}
                  refresh={refresh}
                  notify={notify}
                />
              )}
            </div>
          )}
          {error && (
            <div className="global-error" role="alert">
              <span>{error}</span>
              {session && (
                <button
                  className="text-button"
                  onClick={() => void refresh().catch(() => {})}
                >
                  <RefreshCw size={16} />
                  重试读取
                </button>
              )}
              <button className="text-button" onClick={() => setError("")}>
                关闭
              </button>
            </div>
          )}
        </main>
        <nav className="bottom-nav" aria-label="主导航">
          {tabs.map(({ name, icon: Icon }, i) => (
            <button
              key={name}
              className={tab === i ? "active" : ""}
              onClick={() => {
                setTab(i);
                setDetail(undefined);
              }}
            >
              <Icon size={21} strokeWidth={tab === i ? 2 : 1.6} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
      {setup && (
        <Modal title="连接你的私人衣柜" onClose={() => setSetup(false)}>
          <div className="modal-body">
            <div className="setup-lock">
              <LockKeyhole size={32} />
            </div>
            <p>
              应用代码已经包含真实数据库保存功能，但还没有连接你的 Supabase
              项目。
            </p>
            <ol>
              <li>在你确认后创建免费的 Supabase 项目。</li>
              <li>执行项目中的数据库配置文件，建立私人照片存储和访问权限。</li>
              <li>填写项目地址和可公开的连接密钥，创建你自己的登录账号。</li>
              <li>免费部署后，即可在 iPhone Safari 使用。</li>
            </ol>
            <p className="notice">
              详细步骤见随项目提供的《部署与使用》。此页面不会把未保存的内容假装成云端数据。
            </p>
            <button className="primary full" onClick={() => setSetup(false)}>
              知道了
            </button>
          </div>
        </Modal>
      )}
      {editor && session && (
        <GarmentEditor
          key={editor === "new" ? "new" : editor.id}
          garment={editor === "new" ? undefined : editor}
          userId={session.user.id}
          categories={categories}
          onClose={() => setEditor(undefined)}
          onSaved={(s) => {
            setEditor(undefined);
            setDetail(undefined);
            notify(s);
            void refresh().catch(() => {});
          }}
        />
      )}
      {detail && (
        <Modal
          title={detail.code + " · 单品档案"}
          onClose={() => setDetail(undefined)}
          wide
        >
          <div className="modal-body">
            <div className="detail-photos">
              {detail.photos.length ? (
                detail.photos.map((p) => (
                  <Photo key={p.id} path={p.path} alt={detail.data.name} />
                ))
              ) : (
                <Photo alt={detail.data.name} />
              )}
            </div>
            <div className="detail-heading">
              <div>
                <p className="eyebrow">
                  {detail.code} / {detail.data.category}
                </p>
                <h2>{detail.data.name}</h2>
              </div>
              <button
                className="button"
                onClick={() => {
                  setEditor(detail);
                  setDetail(undefined);
                }}
              >
                <Pencil size={17} />
                编辑
              </button>
            </div>
            <div className="chips">
              {[detail.data.status, ...detail.data.tags]
                .filter(Boolean)
                .map((t, i) => (
                  <span className="chip" key={i}>
                    {t}
                  </span>
                ))}
            </div>
            <dl className="detail-grid">
              {[
                ["颜色", detail.data.color],
                ["版型", detail.data.fit],
                ["二级分类", detail.data.subcategory],
                ["季节", detail.data.seasons.join(" / ")],
                ["材质", detail.data.material],
                ["厚度", detail.data.thickness],
                ["品牌", detail.data.brand],
                ["尺码", detail.data.size],
                [
                  "购买价格",
                  detail.data.price === null ? "" : `¥ ${detail.data.price}`,
                ],
                ["购买日期", detail.data.purchase_date],
                ["购买渠道", detail.data.channel],
                ["穿着频率（手动）", detail.data.frequency],
                ["喜欢程度", `${detail.data.rating} / 5`],
                ["是否闲置", detail.data.idle ? "是" : "否"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v || "未填写"}</dd>
                </div>
              ))}
            </dl>
            {detail.data.notes && (
              <div className="notes">
                <h3>关于这件衣服</h3>
                <p>{detail.data.notes}</p>
              </div>
            )}
            <p className="caption">
              收录于 {new Date(detail.created_at).toLocaleDateString("zh-CN")} ·
              编号保持不变
            </p>
            <div className="detail-actions">
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  perform(() => changeArchive([detail], !detail.data.archived))
                }
              >
                <Archive size={18} />
                {detail.data.archived ? "移回衣柜" : "归档这件衣服"}
              </button>
              <button
                className="text-button danger"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      `永久删除 ${detail.code} 和所有照片？不能撤销，建议先备份。`,
                    )
                  )
                    void perform(async () => {
                      const warning = await deleteGarments([detail]);
                      setDetail(undefined);
                      await refresh();
                      notify(warning || "已永久删除");
                    });
                }}
              >
                <Trash2 size={17} />
                永久删除
              </button>
            </div>
          </div>
        </Modal>
      )}
      {batch && session && (
        <Modal title="批量收录" onClose={() => !busy && setBatch(false)}>
          <div className="modal-body">
            <p>
              每张照片建立一件独立衣服，名称使用照片文件名，分类默认“其他”。单件衣服的多张照片请使用“收录衣服”。每批最多
              20 张。
            </p>
            <label className="button full">
              选择照片
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                hidden
                disabled={busy}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (files.length > 20) {
                    setBatchStatus("每批最多 20 张照片");
                    return;
                  }
                  void perform(async () => {
                    let ok = 0;
                    const failed: string[] = [];
                    for (let i = 0; i < files.length; i++) {
                      setBatchStatus(`正在收录 ${i + 1}/${files.length}`);
                      let path = "";
                      try {
                        const p = await compressImage(files[i]);
                        const photoId = crypto.randomUUID();
                        path = await uploadPhoto(
                          session.user.id,
                          photoId,
                          p.blob,
                        );
                        await saveGarment(
                          crypto.randomUUID(),
                          {
                            ...emptyGarment,
                            name:
                              files[i].name
                                .replace(/\.[^.]+$/, "")
                                .slice(0, 100) || "新衣服",
                            category: "其他",
                          },
                          [
                            {
                              id: photoId,
                              path,
                              size: p.blob.size,
                              width: p.width,
                              height: p.height,
                              position: 0,
                            },
                          ],
                          0,
                        );
                        ok++;
                      } catch (err) {
                        failed.push(`${files[i].name}：${friendlyError(err)}`);
                        if (path)
                          try {
                            await removeFiles([path]);
                          } catch {}
                      }
                    }
                    setBatchStatus(
                      `已保存 ${ok}/${files.length} 件。${failed.length ? "失败文件：" + failed.join("；") : "全部收录完成。"}`,
                    );
                    await refresh();
                  });
                }}
              />
            </label>
            <p role="status">{batchStatus}</p>
          </div>
        </Modal>
      )}
    </>
  );
}
