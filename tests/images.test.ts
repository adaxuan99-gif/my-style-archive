import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_INPUT,
  SUPPORTED_IMAGE_TYPES,
  validateImageInput,
} from "../lib/images";

test("大于 20MB 的常见照片会进入本地处理范围", () => {
  assert.ok(MAX_INPUT > 20 * 1024 * 1024);
  assert.doesNotThrow(() =>
    validateImageInput({ size: 21 * 1024 * 1024, type: "image/jpeg" }),
  );
});

test("接受 iPhone 常见 JPEG、HEIC、HEIF 类型", () => {
  for (const type of ["image/jpeg", "image/heic", "image/heif"]) {
    assert.ok(SUPPORTED_IMAGE_TYPES.includes(type as never));
    assert.doesNotThrow(() => validateImageInput({ size: 1, type }));
  }
});

test("异常过大的文件和不支持类型给出明确错误", () => {
  assert.throws(
    () => validateImageInput({ size: MAX_INPUT + 1, type: "image/jpeg" }),
    /超过 200MB/,
  );
  assert.throws(
    () => validateImageInput({ size: 1, type: "image/tiff" }),
    /请选择 JPEG、PNG、WebP/,
  );
});
