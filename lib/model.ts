import { z } from "zod";
export const CATEGORIES = [
  "上衣",
  "裤子",
  "裙子",
  "外套",
  "连衣裙",
  "鞋子",
  "包包",
  "帽子",
  "首饰",
  "其他配饰",
  "其他",
];
export const SEASONS = ["春", "夏", "秋", "冬", "四季"];
export const STATUSES = [
  "经常穿",
  "偶尔穿",
  "喜欢但不会搭",
  "很少穿",
  "准备出售",
  "准备淘汰",
  "已出售或已淘汰",
] as const;
const short = z.string().max(200);
export const garmentDataSchema = z.object({
  name: z.string().trim().min(1, "请填写衣服名称").max(100),
  category: z.string().trim().min(1).max(50),
  subcategory: short,
  color: short,
  fit: short,
  material: short,
  thickness: short,
  seasons: z.array(short).max(10),
  tags: z.array(short).max(30),
  brand: short,
  size: short,
  price: z.number().finite().min(0).max(10000000).nullable(),
  purchase_date: z
    .string()
    .refine(
      (s) =>
        s === "" || (/^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s))),
      "日期格式不正确",
    ),
  channel: short,
  frequency: short,
  rating: z.number().int().min(1).max(5),
  idle: z.boolean(),
  status: z.enum(STATUSES),
  notes: z.string().max(5000),
  archived: z.boolean(),
});
export type GarmentData = z.infer<typeof garmentDataSchema>;
export const emptyGarment: GarmentData = {
  name: "",
  category: "裤子",
  subcategory: "",
  color: "",
  fit: "",
  material: "",
  thickness: "",
  seasons: [],
  tags: [],
  brand: "",
  size: "",
  price: null,
  purchase_date: "",
  channel: "",
  frequency: "",
  rating: 3,
  idle: false,
  status: "偶尔穿",
  notes: "",
  archived: false,
};
export const photoSchema = z.object({
  id: z.uuid(),
  path: z.string().max(300),
  size: z
    .number()
    .int()
    .positive()
    .max(2 * 1024 * 1024),
  width: z.number().int().positive().max(1600),
  height: z.number().int().positive().max(1600),
  position: z.number().int().min(0).max(11),
});
export type Photo = z.infer<typeof photoSchema> & {
  garment_id?: string;
  user_id?: string;
};
export const garmentSchema = z.object({
  id: z.uuid(),
  code: z.string().regex(/^[A-Z]{1,3}[0-9]{3,10}$/),
  data: garmentDataSchema,
  version: z.number().int().positive(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});
export type Garment = z.infer<typeof garmentSchema> & { photos: Photo[] };
export const profileSchema = z.object({
  height: z.number().min(50).max(250).nullable(),
  likes: z.string().max(5000),
  dislikes: z.string().max(5000),
  colors: z.string().max(1000),
  shoes: z.string().max(2000),
  principles: z.string().max(5000),
  notes: z.string().max(5000),
});
export type Profile = z.infer<typeof profileSchema>;
export const initialProfile: Profile = {
  height: 157,
  likes:
    "怪趣复古、民族风混搭、中国风混搭、运动风与女性化单品混搭、宽松廓形、解构设计、层次感、少年感、松弛感、有趣的配饰、特别的裤型。喜欢有个人辨识度的日常穿搭，希望每天穿得有个性。",
  dislikes: "过于普通、过度乖巧、刻意甜美、没有搭配逻辑的堆砌。",
  colors: "喜欢蓝色，但不限制其他颜色。",
  shoes: "不喜欢尖头鞋，不适合细高跟鞋。",
  principles:
    "不盲目购买；先检查已有相似单品。区分审美喜欢、实际适合和购买必要性。AI 应独立评价，不一味迎合；证据不足时明确说明。",
  notes: "这些是初始偏好，可以随时间变化。",
};
export type Filters = {
  query: string;
  category: string;
  color: string;
  season: string;
  tag: string;
  archived: boolean;
};
export function filterGarments(items: Garment[], f: Filters) {
  return items.filter(
    (g) =>
      g.data.archived === f.archived &&
      (!f.category || g.data.category === f.category) &&
      (!f.color || g.data.color.includes(f.color)) &&
      (!f.season || g.data.seasons.includes(f.season)) &&
      (!f.tag || g.data.tags.some((t) => t.includes(f.tag))) &&
      (!f.query ||
        [g.code, g.data.name, g.data.brand, g.data.notes, ...g.data.tags]
          .join(" ")
          .toLocaleLowerCase()
          .includes(f.query.trim().toLocaleLowerCase())),
  );
}
export function csvCell(value: unknown) {
  const s = String(value ?? "");
  return (
    '"' + (/^[=+\-@\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""') + '"'
  );
}
export function garmentsCSV(items: Garment[]) {
  return (
    "\uFEFF" +
    [
      [
        "编号",
        "名称",
        "分类",
        "颜色",
        "季节",
        "标签",
        "品牌",
        "尺码",
        "价格",
        "状态",
        "归档",
        "照片路径",
        "备注",
      ],
      ...items.map((g) => [
        g.code,
        g.data.name,
        g.data.category,
        g.data.color,
        g.data.seasons.join(" / "),
        g.data.tags.join(" / "),
        g.data.brand,
        g.data.size,
        g.data.price,
        g.data.status,
        g.data.archived ? "是" : "否",
        g.photos.map((p) => "photos/" + p.id + ".jpg").join(" | "),
        g.data.notes,
      ]),
    ]
      .map((r) => r.map(csvCell).join(","))
      .join("\r\n")
  );
}
