"use client";
import { useState } from "react";
import { formatVideoTime, youtubeEmbedUrl, type YouTubeVideo as Video } from "../../lib/youtube";

export function YouTubeVideo({ video }: { video: Video }) {
  const [playCount, setPlayCount] = useState(0);
  const start = formatVideoTime(video.startSeconds);
  return <section className="youtube-video" aria-label="정답 공개 영상">
    <div className="youtube-player">{playCount ? <iframe key={playCount} src={youtubeEmbedUrl(video)} title="유튜브 정답 공개 영상" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /> : <button type="button" className="youtube-play" onClick={() => setPlayCount(1)}><span aria-hidden="true">▶</span><strong>영상 재생</strong><small>{start}부터 시작</small></button>}</div>
    <div className="row between youtube-controls"><span>{start}부터 재생</span>{playCount > 0 && <button type="button" className="button button-small button-plain" onClick={() => setPlayCount(count => count + 1)}>설정 구간부터 다시 재생</button>}</div>
  </section>;
}
