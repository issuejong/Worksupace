"use client";
import { useEffect, useRef, useState } from "react";

export function QuestionImage({ label, description, imageId, disabled, onUpload, onRemove }: { label: string; description: string; imageId: string | null; disabled: boolean; onUpload: (file: File) => Promise<void>; onRemove: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  useEffect(() => { setFailed(false); }, [imageId]);
  return <section className="question-image-upload stack" aria-label={label}>
    <h3>{label}</h3><p className="subtle small">{description}</p>
    {imageId && !failed ? <img className="question-image-preview" src={`/api/media/${imageId}`} alt={`${label} 미리보기`} onError={() => setFailed(true)} /> : <div className="question-image-empty">{failed ? "미리보기를 불러오지 못했어요. 사진을 다시 올려 주세요." : "등록된 사진 없음"}</div>}
    <input ref={input} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" aria-label={`${label} 선택`} disabled={disabled || uploading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) { setUploading(true); void onUpload(file).finally(() => setUploading(false)); } }} />
    <div className="row"><button type="button" className="button button-small button-plain" disabled={disabled || uploading} onClick={() => input.current?.click()}>{uploading ? "사진 올리는 중..." : imageId ? "사진 교체" : "사진 올리기"}</button>{imageId && <button type="button" className="button button-small button-danger" disabled={disabled || uploading} onClick={onRemove}>연결 해제</button>}</div>
    <p className="subtle small">JPG·PNG·WebP · 최대 30MB · 업로드 크기 자동 조정</p>
  </section>;
}
