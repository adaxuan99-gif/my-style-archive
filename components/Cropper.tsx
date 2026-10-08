"use client";
import { useEffect, useState } from "react";
import Modal from "./Modal";
import { loadImage, compressImage } from "@/lib/images";
export default function Cropper({
  blob,
  onDone,
  onClose,
}: {
  blob: Blob;
  onDone: (result: { blob: Blob; width: number; height: number }) => void;
  onClose: () => void;
}) {
  const [image, setImage] = useState<HTMLImageElement>();
  const [url, setUrl] = useState("");
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    loadImage(blob)
      .then(setImage)
      .catch((e) => setError(e.message));
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  const size = image
    ? Math.min(image.naturalWidth, image.naturalHeight) / zoom
    : 1;
  const sx = image ? ((image.naturalWidth - size) * x) / 100 : 0,
    sy = image ? ((image.naturalHeight - size) * y) / 100 : 0;
  return (
    <Modal title="裁剪照片" onClose={() => !busy && onClose()}>
      <div className="modal-body">
        <p className="muted">调整取景位置，保留你想展示的细节。</p>
        <div className="crop-preview">
          {image && (
            <img
              src={url}
              alt="裁剪预览"
              style={{
                width: `${(image.naturalWidth / size) * 100}%`,
                maxWidth: "none",
                height: "auto",
                left: `${(-sx / size) * 100}%`,
                top: `${(-sy / size) * 100}%`,
              }}
            />
          )}
        </div>
        <label>
          放大
          <input
            type="range"
            min="1"
            max="3"
            step="0.05"
            value={zoom}
            onChange={(e) => setZoom(+e.target.value)}
          />
        </label>
        <label>
          左右位置
          <input
            type="range"
            min="0"
            max="100"
            value={x}
            onChange={(e) => setX(+e.target.value)}
          />
        </label>
        <label>
          上下位置
          <input
            type="range"
            min="0"
            max="100"
            value={y}
            onChange={(e) => setY(+e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button
          className="primary full"
          disabled={!image || busy}
          onClick={async () => {
            setBusy(true);
            try {
              onDone(await compressImage(blob, { x: sx, y: sy, size }));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "处理照片…" : "使用裁剪后的照片"}
        </button>
      </div>
    </Modal>
  );
}
