// Odbiór wydatków z aplikacji Movse.
// Autoryzacja przez x-sync-token (tak jak /api/ingest i /api/mail).
//
// ZASADA: aplikacja przysyła KOMPLET wydatków jednego dnia, a serwer zastępuje
// nimi ten dzień. Dzięki temu usunięcie pozycji w aplikacji propaguje się do
// panelu i nie powstają duplikaty przy ponownej wysyłce.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-sync-token",
  "Access-Control-Max-Age": "86400",
};
function json(body: any, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-sync-token");
  if (!token) return json({ ok: false, error: "missing token" }, 401);

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data: lokal, error: le } = await admin
    .from("lokale")
    .select("id")
    .eq("sync_token", token)
    .single();
  if (le || !lokal) return json({ ok: false, error: "invalid token" }, 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad json" }, 400);
  }

  const day = String(body.day || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
    return json({ ok: false, error: "Nieprawidłowa data (oczekiwano RRRR-MM-DD)." }, 400);

  const raw = Array.isArray(body.items) ? body.items : [];
  const items = raw
    .slice(0, 500)
    .map((it: any) => ({
      lokal_id: lokal.id,
      dzien: day,
      opis: String(it?.opis ?? "").trim().slice(0, 300),
      kwota: Math.round(Number(it?.kwota ?? 0) * 100) / 100,
    }))
    .filter((it: any) => it.opis.length > 0 && Number.isFinite(it.kwota) && it.kwota >= 0);

  // Zastąpienie dnia: najpierw kasujemy, potem wstawiamy komplet.
  const { error: de } = await admin
    .from("wydatki")
    .delete()
    .eq("lokal_id", lokal.id)
    .eq("dzien", day);
  if (de) return json({ ok: false, error: de.message }, 500);

  if (items.length) {
    const { error: ie } = await admin.from("wydatki").insert(items);
    if (ie) return json({ ok: false, error: ie.message }, 500);
  }

  return json({ ok: true, day, count: items.length });
}
