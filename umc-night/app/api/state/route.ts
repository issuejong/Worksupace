import { NextRequest } from "next/server";
import { hostRoute, teamRoute } from "../../../lib/server/auth";
import { errorResponse, noStore } from "../../../lib/server/errors";
import { stateFor } from "../../../lib/server/game";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const view = request.nextUrl.searchParams.get("view");
  if (view === "host") return hostRoute(request, () => stateFor("host"));
  if (view === "team") return teamRoute(request, team => stateFor("team", team.id));
  if (view === "screen") {
    try { return noStore(await stateFor("screen")); }
    catch (error) { return errorResponse(error); }
  }
  return noStore({ error: "올바른 화면을 선택해 주세요." }, 400);
}
