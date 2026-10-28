export interface YouTubeVideo { videoId: string; startSeconds: number; }
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const maxSeconds = 86399;

export function parseVideoTime(value: string): number {
  const text = value.trim();
  let seconds: number;
  if (/^\d+$/.test(text)) seconds = Number(text);
  else if (/^\d+:\d{2}(:\d{2})?$/.test(text)) {
    const parts = text.split(":").map(Number);
    if (parts.slice(1).some(part => part >= 60)) throw new Error("시작 시간의 분·초는 00~59로 입력해 주세요.");
    seconds = parts.reduce((sum, part) => sum * 60 + part, 0);
  } else {
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
    if (!match || !text) throw new Error("시작 시간을 1:20 또는 80처럼 입력해 주세요.");
    seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  }
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > maxSeconds) throw new Error("시작 시간은 0초~23:59:59로 입력해 주세요.");
  return seconds;
}

export function parseYouTubeVideo(value: string, start = ""): YouTubeVideo | null {
  if (!value.trim()) return null;
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("올바른 유튜브 링크를 입력해 주세요."); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) throw new Error("올바른 유튜브 링크를 입력해 주세요.");
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  let id: string | null = null;
  if (host === "youtu.be" && parts.length === 1) id = parts[0];
  else if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else if (parts.length === 2 && ["shorts", "embed", "live"].includes(parts[0])) id = parts[1];
  } else if (["youtube-nocookie.com", "www.youtube-nocookie.com"].includes(host) && parts.length === 2 && parts[0] === "embed") id = parts[1];
  if (!id || !videoIdPattern.test(id)) throw new Error("유튜브 영상 링크를 입력해 주세요. 채널·재생목록 링크는 사용할 수 없습니다.");
  const timestamp = start.trim() || url.searchParams.get("t") || url.searchParams.get("start") || new URLSearchParams(url.hash.slice(1)).get("t") || "0";
  return { videoId: id, startSeconds: parseVideoTime(timestamp) };
}

export function formatVideoTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const rest = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

export function youtubeEmbedUrl(video: YouTubeVideo): string {
  if (!videoIdPattern.test(video.videoId) || !Number.isInteger(video.startSeconds) || video.startSeconds < 0 || video.startSeconds > maxSeconds) throw new Error("유효하지 않은 영상 설정입니다.");
  const url = new URL(`https://www.youtube-nocookie.com/embed/${video.videoId}`);
  url.search = new URLSearchParams({ start: String(video.startSeconds), autoplay: "1", playsinline: "1", rel: "0" }).toString();
  return url.toString();
}
