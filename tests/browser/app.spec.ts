import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { emptyGarment, initialProfile } from "../../lib/model";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
async function backend(page: Page) {
  let garments: any[] = [];
  const files = new Map<string, Buffer>();
  let profile: any = null;
  let profileVersion = 0;
  let counter = 0;
  const token = [
    Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
    Buffer.from(
      JSON.stringify({
        sub: userId,
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url"),
    "local-test",
  ].join(".");
  await page.route("https://archive-test.supabase.co/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const body = req.postDataJSON?.bind(req);
    const json = (data: any, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (req.method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
        },
      });
    if (path === "/auth/v1/token")
      return json({
        access_token: token,
        refresh_token: "test-refresh",
        token_type: "bearer",
        expires_in: 3600,
        user: {
          id: userId,
          email: "test@example.com",
          aud: "authenticated",
          role: "authenticated",
          created_at: new Date().toISOString(),
          app_metadata: { provider: "email" },
          user_metadata: {},
        },
      });
    if (path === "/auth/v1/logout") return json({});
    if (path === "/rest/v1/garments") return json(garments);
    if (path === "/rest/v1/categories") return json([]);
    if (path === "/rest/v1/profiles")
      return json(
        profile
          ? { user_id: userId, data: profile, version: profileVersion }
          : null,
      );
    if (path === "/rest/v1/rpc/save_profile") {
      profile = body()?.p_data;
      profileVersion++;
      return json(null);
    }
    if (path === "/rest/v1/rpc/save_garment") {
      const b = body()!;
      const old = garments.find((g) => g.id === b.p_id);
      const now = new Date().toISOString();
      const g = {
        id: b.p_id,
        code: old?.code ?? "P" + String(++counter).padStart(3, "0"),
        data: b.p_data,
        photos: b.p_photos,
        version: (old?.version ?? 0) + 1,
        created_at: old?.created_at ?? now,
        updated_at: now,
      };
      garments = [...garments.filter((x) => x.id !== g.id), g];
      return json(g.id);
    }
    if (path === "/rest/v1/rpc/delete_garments") {
      garments = garments.filter((g) => !body()!.p_ids.includes(g.id));
      return json(null);
    }
    if (path === "/rest/v1/rpc/export_archive")
      return json({
        format: "my-style-archive",
        version: 1,
        exported_at: new Date().toISOString(),
        garments,
        profile,
        categories: [],
        counters: [{ prefix: "P", last_value: counter }],
      });
    if (path === "/rest/v1/rpc/restore_archive") {
      const b = body()!.p_archive;
      let n = 0;
      for (const g of b.garments)
        if (!garments.some((x) => x.id === g.id)) {
          garments.push(g);
          n++;
        }
      return json(n);
    }
    if (path.startsWith("/storage/v1/object/")) {
      if (req.method() === "POST") {
        files.set(
          path.replace("/storage/v1/object/", ""),
          req.postDataBuffer()!,
        );
        return json({ Key: path });
      }
      if (req.method() === "GET") {
        const key = path
          .replace("/storage/v1/object/authenticated/", "")
          .replace("/storage/v1/object/", "");
        const file = files.get(key);
        return file
          ? route.fulfill({
              status: 200,
              contentType: "image/jpeg",
              body: file,
            })
          : json({ message: "Not found" }, 404);
      }
      if (req.method() === "DELETE") {
        for (const p of body()?.prefixes ?? []) files.delete("wardrobe/" + p);
        return json([]);
      }
    }
    return json({ message: "Unmocked endpoint: " + path }, 400);
  });
  return { getGarments: () => garments };
}
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("邮箱", { exact: true }).fill("test@example.com");
  await page.getByLabel("密码", { exact: true }).fill("correct-password");
  await page.getByRole("button", { name: "登录我的衣柜", exact: true }).click();
  await expect(page.getByRole("heading", { name: "我的衣柜." })).toBeVisible();
}
function nav(page: Page, name: string) {
  return page
    .locator(".bottom-nav:visible,.sidebar:visible")
    .getByRole("button", { name, exact: true });
}
async function inputImage(page: Page) {
  return await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 500;
    c.height = 600;
    const x = c.getContext("2d")!;
    x.fillStyle = "#3a5fb5";
    x.fillRect(0, 0, 500, 600);
    return c.toDataURL("image/jpeg").split(",")[1];
  });
}

test("登录限制、图片录入、多图编辑、筛选、归档和删除", async ({ page }) => {
  const state = await backend(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "登录我的衣柜" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "收录衣服", exact: true }),
  ).toHaveCount(0);
  await login(page);
  await page.getByRole("button", { name: "收录第一件衣服" }).click();
  const image = Buffer.from(await inputImage(page), "base64");
  await page
    .getByLabel("从相册上传照片", { exact: true })
    .setInputFiles([
      { name: "裤子.jpg", mimeType: "image/jpeg", buffer: image },
    ]);
  await expect(page.locator(".draft-photo")).toHaveCount(1);
  await page.getByLabel("名称", { exact: false }).fill("蓝色阔腿牛仔裤");
  await page.getByLabel("颜色", { exact: true }).fill("蓝色");
  await page.getByRole("button", { name: "秋", exact: true }).click();
  await page
    .getByRole("button", { name: "保存到我的衣柜", exact: true })
    .click();
  await expect(page.locator(".garment-card")).toHaveCount(1);
  await page.getByLabel("搜索衣服").fill("p001");
  await expect(page.locator(".garment-card")).toHaveCount(1);
  await page.getByLabel("搜索衣服").fill("不存在");
  await expect(page.locator(".garment-card")).toHaveCount(0);
  await page.getByLabel("搜索衣服").fill("");
  await page
    .locator(".category-tabs")
    .getByRole("button", { name: "鞋子", exact: true })
    .click();
  await expect(page.locator(".garment-card")).toHaveCount(0);
  await page
    .locator(".category-tabs")
    .getByRole("button", { name: "裤子", exact: true })
    .click();
  await page.locator(".garment-card").click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("从相册上传照片").setInputFiles([
    { name: "细节.jpg", mimeType: "image/jpeg", buffer: image },
    { name: "背面.jpg", mimeType: "image/jpeg", buffer: image },
  ]);
  await expect(page.locator(".draft-photo")).toHaveCount(3);
  await page.getByRole("button", { name: "裁剪照片 2", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "裁剪照片", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "使用裁剪后的照片" }).click();
  await page.getByRole("button", { name: "设照片 2 为封面" }).click();
  await page.getByLabel("名称", { exact: false }).fill("修改后的蓝色牛仔裤");
  await page
    .getByRole("button", { name: "保存到我的衣柜", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "修改后的蓝色牛仔裤" }),
  ).toBeVisible();
  expect(state.getGarments()[0].photos).toHaveLength(3);
  await page.locator(".garment-card").click();
  await page.getByRole("button", { name: "归档这件衣服" }).click();
  await expect(page.locator(".garment-card")).toHaveCount(0);
  await page.getByRole("button", { name: "已归档", exact: true }).click();
  await expect(page.locator(".garment-card")).toHaveCount(1);
  await page.locator(".garment-card").click();
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "永久删除", exact: true }).click();
  expect(state.getGarments()).toHaveLength(1);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "永久删除", exact: true }).click();
  await expect(page.locator(".garment-card")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("风格档案、照片 ZIP 导出、删除后恢复与重复恢复", async ({ page }) => {
  await backend(page);
  await login(page);
  await page.getByRole("button", { name: "收录第一件衣服" }).click();
  const image = Buffer.from(await inputImage(page), "base64");
  await page
    .getByLabel("从相册上传照片")
    .setInputFiles([
      { name: "裤子.jpg", mimeType: "image/jpeg", buffer: image },
    ]);
  await expect(page.locator(".draft-photo")).toHaveCount(1);
  await page.getByLabel("名称", { exact: false }).fill("备份测试裤子");
  await page
    .getByRole("button", { name: "保存到我的衣柜", exact: true })
    .click();
  await expect(page.locator(".garment-card")).toHaveCount(1);
  await nav(page, "风格档案").click();
  await page.getByLabel("我喜欢的元素").fill("蓝色与宽松轮廓");
  await page.getByRole("button", { name: "保存风格档案" }).click();
  await expect(page.getByRole("status")).toContainText("风格档案已保存");
  await nav(page, "我的").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载完整 ZIP 备份" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = await readFile(path!);
  expect(bytes.length).toBeGreaterThan(1000);
  await nav(page, "我的衣柜").click();
  await page.locator(".garment-card").click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "永久删除", exact: true }).click();
  await expect(page.locator(".garment-card")).toHaveCount(0);
  await nav(page, "我的").click();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "backup.zip",
      mimeType: "application/zip",
      buffer: bytes,
    });
  await expect(page.getByText("备份检查通过")).toBeVisible();
  await page.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("恢复成功，新增 1");
  await nav(page, "我的衣柜").click();
  await expect(page.locator(".garment-card")).toHaveCount(1);
  await expect(page.locator(".garment-card img")).toBeVisible();
  await nav(page, "我的").click();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "backup.zip",
      mimeType: "application/zip",
      buffer: bytes,
    });
  await page.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("新增 0");
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(
    page.getByRole("button", { name: "登录我的衣柜" }),
  ).toBeVisible();
});
