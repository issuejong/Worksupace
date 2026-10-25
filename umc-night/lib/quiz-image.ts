const accepted = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateQuizImage(file: Pick<File, "type" | "size">) {
  if (!accepted.has(file.type)) throw new Error("JPG, PNG, WebP 사진을 선택해 주세요. HEIC 사진은 JPG로 변환한 뒤 올려 주세요.");
  if (!file.size || file.size > 30 * 1024 * 1024) throw new Error("사진은 30MB 이하로 선택해 주세요.");
}

// Resize on the device before uploading large camera photos. Re-encoding also
// keeps the original filename and camera metadata out of the public quiz image.
export async function prepareQuizImage(file: File): Promise<File> {
  validateQuizImage(file);
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("사진을 읽지 못했습니다. 다른 JPG·PNG 사진으로 다시 시도해 주세요."));
      image.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("사진 크기를 확인할 수 없습니다.");
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("이 기기에서 사진을 처리하지 못했습니다.");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encode = (type: string, quality: number) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
    let blob = await encode("image/webp", .9);
    if (!blob || blob.size > 3 * 1024 * 1024) blob = await encode("image/jpeg", .8);
    if (!blob || blob.size > 3 * 1024 * 1024) throw new Error("사진 크기를 줄이지 못했습니다. 조금 작은 사진으로 다시 시도해 주세요.");
    const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
    return new File([blob], `quiz-photo.${ext}`, { type: blob.type });
  } finally { URL.revokeObjectURL(url); }
}
