import { NextRequest, NextResponse } from "next/server";
import { duplicateProject } from "@/lib/vault";

export async function POST(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const project = await duplicateProject(id);
    return NextResponse.json(project);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
