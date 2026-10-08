import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyGarment,
  filterGarments,
  garmentDataSchema,
  garmentsCSV,
  initialProfile,
  profileSchema,
  type Garment,
} from "../lib/model";
import { validateArchive } from "../lib/backup";
const garment: Garment = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "P001",
  data: {
    ...emptyGarment,
    name: "做旧牛仔裤",
    color: "蓝色",
    tags: ["复古"],
    seasons: ["秋"],
  },
  version: 1,
  created_at: "2026-10-08T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z",
  photos: [],
};
const filters = {
  query: "",
  category: "",
  color: "",
  season: "",
  tag: "",
  archived: false,
};
test("搜索编号不区分大小写，分类/颜色/季节/风格组合筛选", () => {
  assert.equal(
    filterGarments([garment], {
      ...filters,
      query: "p001",
      category: "裤子",
      color: "蓝",
      season: "秋",
      tag: "复古",
    }).length,
    1,
  );
  assert.equal(
    filterGarments([garment], { ...filters, category: "鞋子" }).length,
    0,
  );
});
test("归档内容默认隐藏，可独立查找", () => {
  const archived = { ...garment, data: { ...garment.data, archived: true } };
  assert.equal(filterGarments([archived], filters).length, 0);
  assert.equal(
    filterGarments([archived], { ...filters, archived: true }).length,
    1,
  );
});
test("名称必填，购买信息可空，负价格不允许", () => {
  assert.equal(garmentDataSchema.safeParse(emptyGarment).success, false);
  assert.equal(garmentDataSchema.safeParse(garment.data).success, true);
  assert.equal(
    garmentDataSchema.safeParse({ ...garment.data, price: -1 }).success,
    false,
  );
  assert.equal(profileSchema.safeParse(initialProfile).success, true);
});
test("CSV 防公式注入且保留引号与换行", () => {
  const csv = garmentsCSV([
    { ...garment, data: { ...garment.data, name: "=1+1", notes: 'a"b\nc' } },
  ]);
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"a""b\nc"'));
});
test("备份拒绝重复编号与不支持版本", () => {
  const archive = {
    format: "my-style-archive",
    version: 1,
    exported_at: "today",
    garments: [garment],
    profile: initialProfile,
    categories: [],
    counters: [],
  };
  assert.equal(validateArchive(archive).garments.length, 1);
  assert.throws(() =>
    validateArchive({ ...archive, garments: [garment, garment] }),
  );
  assert.throws(() => validateArchive({ ...archive, version: 2 }));
});
