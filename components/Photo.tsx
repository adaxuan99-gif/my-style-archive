"use client";
import { useEffect, useRef, useState } from "react";
import { ImageOff, Shirt } from "lucide-react";
import { downloadPhoto } from "@/lib/repository";
export default function Photo({
  path,
  alt,
  className = "",
}: {
  path?: string;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    let objectUrl = "";
    let started = false;
    setUrl("");
    setFailed(false);
    const load = () => {
      if (!path || started) return;
      started = true;
      downloadPhoto(path)
        .then((b) => {
          objectUrl = URL.createObjectURL(b);
          if (alive) setUrl(objectUrl);
          else URL.revokeObjectURL(objectUrl);
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          load();
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    if (ref.current && path) observer.observe(ref.current);
    return () => {
      alive = false;
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);
  return (
    <div ref={ref} className={`photo ${className}`}>
      {url ? (
        <img src={url} alt={alt} loading="lazy" />
      ) : failed ? (
        <span>
          <ImageOff />
          <small>照片加载失败</small>
        </span>
      ) : (
        <span>
          <Shirt />
          <small>{path ? "加载照片…" : "尚未添加照片"}</small>
        </span>
      )}
    </div>
  );
}
