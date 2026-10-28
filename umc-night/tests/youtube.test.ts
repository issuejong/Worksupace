import { describe, expect, it } from "vitest";
import { formatVideoTime, parseVideoTime, parseYouTubeVideo, youtubeEmbedUrl } from "../lib/youtube";

describe("YouTube quiz clips", () => {
  const id = "M7lc1UVf-VE";
  it.each([
    [`https://youtu.be/${id}?t=80`,80],
    [`https://www.youtube.com/watch?v=${id}&t=1m20s`,80],
    [`https://m.youtube.com/watch?v=${id}#t=90`,90],
    [`https://www.youtube.com/shorts/${id}`,0],
    [`https://www.youtube.com/live/${id}`,0],
    [`https://www.youtube-nocookie.com/embed/${id}?start=12`,12],
  ])("accepts supported video links: %s", (url, seconds) => {
    expect(parseYouTubeVideo(url as string)).toEqual({videoId:id,startSeconds:seconds});
  });
  it("lets an explicit time override the link timestamp, including zero", () => {
    const url = `https://youtu.be/${id}?t=80`;
    expect(parseYouTubeVideo(url,"2:05")?.startSeconds).toBe(125);
    expect(parseYouTubeVideo(url,"0")?.startSeconds).toBe(0);
    expect(parseYouTubeVideo("", "1:20")).toBeNull();
  });
  it.each(["https://youtube.com.evil.example/watch?v=M7lc1UVf-VE", "javascript:alert(1)", "https://evil.example/embed/M7lc1UVf-VE", "https://youtube.com/playlist?list=abc", "https://youtube.com/watch?v=bad", "https://user:pass@youtube.com/watch?v=M7lc1UVf-VE", "https://youtu.be/M7lc1UVf-VE/extra", "https://youtu.be/M7lc1UVf-VE?t=bad"]) ("rejects invalid or unsafe URLs: %s", url => {
    expect(() => parseYouTubeVideo(url)).toThrow();
  });
  it.each(["1:60", "1:00:60", "-1", "1.5", "24:00:00", "abc", "", "999999999999999999999"]) ("rejects invalid times: %s", time => {
    expect(() => parseVideoTime(time)).toThrow();
  });
  it("formats times and builds only a known-host embed with a second-based start", () => {
    expect(parseVideoTime("1:02:03")).toBe(3723);
    expect(formatVideoTime(3723)).toBe("1:02:03");
    expect(formatVideoTime(80)).toBe("1:20");
    const url = new URL(youtubeEmbedUrl({videoId:id,startSeconds:80}));
    expect(url.origin).toBe("https://www.youtube-nocookie.com");
    expect(url.pathname).toBe(`/embed/${id}`);
    expect(url.searchParams.get("start")).toBe("80");
    expect(() => youtubeEmbedUrl({videoId:"../bad",startSeconds:0})).toThrow();
  });
});
