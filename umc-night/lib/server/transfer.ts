import { hash, newToken } from "./auth";
import { db } from "./db";
import { AppError } from "./errors";

const invalidTransfer = () => new AppError("기기 이전 QR이 만료되었거나 이미 사용되었습니다. 진행자에게 새 QR을 요청해 주세요.", 410, "TRANSFER_EXPIRED");

export async function issueTeamTransfer(teamId: string) {
  const token = newToken();
  return db().begin(async tx => {
    const teams = await tx`select id,number,name from public.teams where id=${teamId} for update`;
    if (!teams.length) throw new AppError("팀을 찾지 못했습니다.", 404, "TEAM_NOT_FOUND");
    await tx`update public.team_transfers set used_at=now() where team_id=${teamId} and used_at is null`;
    const rows = await tx`insert into public.team_transfers(team_id,token_hash,expires_at) values (${teamId},${hash(token)},now()+interval '5 minutes') returning expires_at`;
    return { team: teams[0], token, expiresAt: rows[0].expires_at };
  });
}

export async function inspectTeamTransfer(token: string) {
  const rows = await db()`select t.id,t.number,t.name from public.team_transfers x join public.teams t on t.id=x.team_id where x.token_hash=${hash(token)} and x.used_at is null and x.expires_at>now() limit 1`;
  if (!rows.length) throw invalidTransfer();
  return { team: rows[0] };
}

export async function redeemTeamTransfer(token: string) {
  const sessionToken = newToken();
  return db().begin(async tx => {
    const rows = await tx`select x.id as transfer_id,t.id,t.number,t.name from public.team_transfers x join public.teams t on t.id=x.team_id where x.token_hash=${hash(token)} and x.used_at is null and x.expires_at>now() for update of x`;
    const transfer = rows[0];
    if (!transfer) throw invalidTransfer();
    await tx`update public.team_sessions set revoked_at=now() where team_id=${transfer.id} and revoked_at is null`;
    await tx`insert into public.team_sessions(team_id,token_hash,expires_at) values (${transfer.id},${hash(sessionToken)},now()+interval '12 hours')`;
    await tx`update public.team_transfers set used_at=now() where id=${transfer.transfer_id}`;
    return { team: { id: transfer.id, number: transfer.number, name: transfer.name }, sessionToken };
  });
}
