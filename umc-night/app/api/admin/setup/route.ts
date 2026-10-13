import { NextRequest } from "next/server";
import { hostRoute } from "../../../../lib/server/auth";
import { jsonBody } from "../../../../lib/server/errors";
import { changeSetup, setupState } from "../../../../lib/server/setup";

export const runtime = "nodejs";
export async function GET(request: NextRequest) { return hostRoute(request, setupState); }
export async function POST(request: NextRequest) { return hostRoute(request, async () => changeSetup(await jsonBody(request))); }
