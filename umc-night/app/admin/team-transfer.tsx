"use client";
import { useState } from "react";
import QRCode from "qrcode";
import { api } from "../../lib/client";

interface TransferResult { team: { id: string; name: string }; token: string; expiresAt: string; }

export function TeamTransfer({ teamId, name }: { teamId: string; name: string }) {
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function issue() {
    setBusy(true); setError(""); setQr(""); setUrl("");
    try {
      const result = await api<TransferResult>("/api/admin/transfer", { teamId });
      const nextUrl = new URL(`/transfer#token=${result.token}`, window.location.origin).toString();
      setQr(await QRCode.toDataURL(nextUrl, { width: 256, margin: 2, errorCorrectionLevel: "M" }));
      setUrl(nextUrl); setExpiresAt(result.expiresAt);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "QR 발급에 실패했습니다."); }
    finally { setBusy(false); }
  }

  return <div className="list-item"><div className="row between"><strong>{name}</strong><button type="button" className="button button-small button-plain" disabled={busy} onClick={() => void issue()}>{busy ? "발급 중..." : qr ? "새 QR 발급" : "기기 이전 QR"}</button></div>
    {qr && <div className="transfer-qr"><img src={qr} alt={`${name} 팀 대표 기기 이전 QR 코드`} /><p className="subtle small">새 휴대폰에서 스캔해 연결하세요. {new Date(expiresAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}까지 유효합니다.</p><p className="subtle small">{url}</p></div>}
    {error && <p className="error" role="alert">{error}</p>}</div>;
}
