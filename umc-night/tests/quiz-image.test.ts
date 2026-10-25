import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareQuizImage, validateQuizImage } from "../lib/quiz-image";

const drawImage = vi.fn(); const fillRect = vi.fn();
const canvas = { width: 0, height: 0, getContext: vi.fn(() => ({ fillStyle: "", drawImage, fillRect })), toBlob: vi.fn() };
const encode = (callback: BlobCallback, type: string) => callback(new Blob(["encoded image"], { type }));
class TestImage {
  naturalWidth = 4000; naturalHeight = 3000;
  onload: (() => void) | null = null; onerror: (() => void) | null = null;
  set src(_url: string) { queueMicrotask(() => this.onload?.()); }
}
beforeEach(() => {
  vi.clearAllMocks(); canvas.width = 0; canvas.height = 0;
  canvas.toBlob.mockImplementation(encode);
  vi.stubGlobal("Image", TestImage);
  vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-photo");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("quiz photo preparation", () => {
  it("accepts supported formats and rejects unsupported, empty or oversized files", () => {
    for (const type of ["image/jpeg","image/png","image/webp"]) expect(() => validateQuizImage({ type, size: 1024 })).not.toThrow();
    for (const file of [{type:"image/heic",size:1024},{type:"image/png",size:0},{type:"image/jpeg",size:30*1024*1024+1}]) expect(() => validateQuizImage(file)).toThrow();
  });
  it("resizes camera photos, re-encodes pixels and removes identifying filenames", async () => {
    const file = await prepareQuizImage(new File(["camera data"],"정답-김아코.png",{type:"image/png"}));
    expect([canvas.width,canvas.height]).toEqual([1600,1200]);
    expect(drawImage).toHaveBeenCalledWith(expect.any(TestImage),0,0,1600,1200);
    expect(file.name).toBe("quiz-photo.webp"); expect(file.type).toBe("image/webp");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-photo");
  });
  it("does not enlarge small crops and uses the actual encoding type", async () => {
    vi.stubGlobal("Image",class extends TestImage { naturalWidth=48;naturalHeight=24; });
    canvas.toBlob.mockImplementation(callback=>callback(new Blob(["fallback"],{type:"image/png"})));
    const file=await prepareQuizImage(new File(["crop"],"crop.jpg",{type:"image/jpeg"}));
    expect([canvas.width,canvas.height]).toEqual([48,24]); expect(file.type).toBe("image/png"); expect(file.name).toBe("quiz-photo.png");
  });
  it("falls back to JPEG when the first encoding is too large", async () => {
    canvas.toBlob.mockImplementationOnce(callback=>callback(new Blob([new Uint8Array(3*1024*1024+1)],{type:"image/png"}))).mockImplementation(encode);
    const file=await prepareQuizImage(new File(["photo"],"photo.png",{type:"image/png"}));
    expect(canvas.toBlob).toHaveBeenCalledTimes(2); expect(file.type).toBe("image/jpeg");
  });
  it("releases the local photo URL after a decode failure", async () => {
    vi.stubGlobal("Image",class extends TestImage { set src(_url:string) { queueMicrotask(()=>this.onerror?.()); } });
    await expect(prepareQuizImage(new File(["broken"],"broken.jpg",{type:"image/jpeg"}))).rejects.toThrow("사진을 읽지 못했습니다");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-photo"); expect(drawImage).not.toHaveBeenCalled();
  });
});
