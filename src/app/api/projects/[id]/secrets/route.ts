import { NextRequest, NextResponse } from "next/server";
import { listProjectEntries, upsertEntry } from "@/lib/vault";

export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json(await listProjectEntries(id));
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const body = await req.json();
  const { id } = await ctx.params;

  if (!body?.name || !body?.value) {
    return NextResponse.json({ error: "name and value are required" }, { status: 400 });
  }

  const secret = await upsertEntry({
    name: body.name,
    key: body.key || body.name,
    type: body.type || "Env Variable",
    secretType: body.secretType || "string",
    value: body.value,
    description: body.description || "",
    projectId: id,
    tags: body.tags || [],
    favorite: !!body.favorite,
    includeInEnv: body.includeInEnv ?? true,
  });

  return NextResponse.json(secret);
}
