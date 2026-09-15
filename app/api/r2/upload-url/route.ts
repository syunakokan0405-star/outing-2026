import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { createClient } from "@/lib/supabase/server";
import { r2, R2_BUCKET_NAME } from "@/lib/r2";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized." },
        { status: 401 },
      );
    }

    const body = await request.json();

    const eventId = String(body.eventId ?? "");
    const participantId = String(body.participantId ?? "");
    const clientRequestId = String(body.clientRequestId ?? "");

    if (!eventId || !participantId || !clientRequestId) {
      return NextResponse.json(
        { error: "Missing upload information." },
        { status: 400 },
      );
    }

    // UUID形式だけ許可
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidPattern.test(clientRequestId)) {
      return NextResponse.json(
        { error: "Invalid client request ID." },
        { status: 400 },
      );
    }

    // ログイン中ユーザー本人のparticipantか確認
    const { data: participant, error: participantError } =
      await supabase
        .from("participants")
        .select("id,event_id")
        .eq("id", participantId)
        .eq("event_id", eventId)
        .eq("auth_user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

    if (participantError || !participant) {
      return NextResponse.json(
        { error: "Participant verification failed." },
        { status: 403 },
      );
    }

    // 同じ投稿の再送では必ず同じR2キーを使う
    const key =
      `posts/${eventId}/${participantId}/` +
      `${clientRequestId}.webp`;

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      ContentType: "image/webp",
    });

    const uploadUrl = await getSignedUrl(r2, command, {
      expiresIn: 300,
    });

    return NextResponse.json({
      uploadUrl,
      key,
    });
  } catch (error) {
    console.error("R2 upload URL error:", error);

    return NextResponse.json(
      { error: "Could not create upload URL." },
      { status: 500 },
    );
  }
}