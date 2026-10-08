import { invoke } from "@tauri-apps/api/core";

export type ImageLocation = "sameDir" | "assets";

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const IMAGE_LOCATION_LABELS: Record<ImageLocation, string> = {
  sameDir: "同目录",
  assets: "assets 子目录",
};

/** 由 MIME 推断图片扩展名 */
export function getImageExtension(mime: string | undefined): string {
  if (mime) {
    const lower = mime.toLowerCase();
    if (MIME_EXT[lower]) return MIME_EXT[lower];
    if (lower.startsWith("image/")) {
      const sub = lower.slice("image/".length).split("+")[0];
      if (/^[a-z0-9]+$/.test(sub)) return sub === "jpeg" ? "jpg" : sub;
    }
  }
  return "png";
}

/** 根据扩展名判断是否为图片文件路径（用于拖拽） */
export function isImagePath(path: string): boolean {
  return IMAGE_EXT_RE.test(path);
}

function pad(value: number, len = 2): string {
  return String(value).padStart(len, "0");
}

/** 生成 image-20260917-153000 形式的基础名（不含扩展名） */
export function buildImageBaseName(now: Date = new Date()): string {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `image-${stamp}`;
}

/** 取目录部分（兼容 Windows 反斜杠） */
export function dirnameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx < 0 ? "" : path.slice(0, idx);
}

/** 拼接路径，保留原路径的分隔符风格 */
export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const useBackslash = dir.includes("\\") && !dir.includes("/");
  const sep = useBackslash ? "\\" : "/";
  return dir.replace(/[\\/]+$/, "") + sep + name;
}

/** 统一转成正斜杠 */
export function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await invoke("get_file_metadata", { path });
    return true;
  } catch {
    return false;
  }
}

/** 在目录中找一个不冲突的图片文件名 */
export async function findAvailableImageName(dir: string, ext: string): Promise<string> {
  const base = buildImageBaseName();
  const first = `${base}.${ext}`;
  if (!(await pathExists(joinPath(dir, first)))) return first;
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}-${i}.${ext}`;
    if (!(await pathExists(joinPath(dir, candidate)))) return candidate;
  }
  return `${base}-${Date.now()}.${ext}`;
}

/** 根据配置得到图片所在目录（绝对路径） */
export function imageTargetDir(mdDir: string, location: ImageLocation): string {
  return location === "assets" ? joinPath(mdDir, "assets") : mdDir;
}

/** 插入到 Markdown 中的引用路径 */
export function toMarkdownRef(imageName: string, location: ImageLocation): string {
  return location === "assets" ? `assets/${imageName}` : imageName;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePosix(path: string): string {
  const driveMatch = path.match(/^([a-zA-Z]:)(\/|$)/);
  const drive = driveMatch ? driveMatch[1] : "";
  const isAbsolute = path.startsWith("/");
  const rest = drive ? path.slice(drive.length) : path;
  const out: string[] = [];
  for (const part of rest.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length) out.pop();
      continue;
    }
    out.push(part);
  }
  const prefix = drive ? `${drive}/` : isAbsolute ? "/" : "";
  return prefix + out.join("/");
}

/**
 * 将 Markdown 中的图片引用解析为绝对文件路径（正斜杠）。
 * 用于预览时交给 convertFileSrc 渲染本地图片。
 */
export function resolveLocalImagePath(mdPath: string, src: string): string {
  const decoded = safeDecode(src).trim();
  const isAbsolute = /^[a-zA-Z]:[\\/]/.test(decoded) || decoded.startsWith("/");
  const base = dirnameOf(toPosix(mdPath));
  const combined = isAbsolute ? toPosix(decoded) : `${base}/${decoded}`;
  return normalizePosix(combined);
}
