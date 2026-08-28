"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { submitPostReliably } from "@/lib/post-submit";

type FacingMode = "user" | "environment";
type Visibility = "stream" | "gallery";
type Stage = "camera" | "edit" | "publish" | "done";

type CaptureInfo = {
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
  compressedBytes: number;
};

type ParticipantOption = {
  id: string;
  name: string;
};

const MAX_SIDE = 1800;
const WEBP_QUALITY = 0.82;
const MAX_COMMENT = 30;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function MissionCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const supabase = useMemo(() => createClient(), []);

  const [missionTitle, setMissionTitle] = useState("違うクラスの異性と写真！");
  const [missionPoints, setMissionPoints] = useState(20);
  const [missionId, setMissionId] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("camera");

  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const [capture, setCapture] = useState<CaptureInfo | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flashSupported, setFlashSupported] = useState(false);
  const [flashOn, setFlashOn] = useState(false);

  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionOptions, setMentionOptions] = useState<ParticipantOption[]>([]);
  const [mentions, setMentions] = useState<ParticipantOption[]>([]);
  const [comment, setComment] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("stream");
  const [posting, setPosting] = useState(false);
  const [postedId, setPostedId] = useState<string | null>(null);
  const [queuedOffline, setQueuedOffline] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const title = params.get("title");
    const points = Number(params.get("points"));
    const mId = params.get("missionId");
    const eId = params.get("eventId");
    if (title) setMissionTitle(title);
    if (Number.isFinite(points) && points >= 0) setMissionPoints(points);
    if (mId) setMissionId(mId);
    if (eId) setEventId(eId);
  }, []);

  useEffect(() => {
    async function loadParticipant() {
      const { data: authData } = await supabase.auth.getUser();
      const uid = authData.user?.id;
      if (!uid) return;
      const query = supabase.from("participants").select("id,event_id").eq("auth_user_id", uid).eq("is_active", true).limit(1);
      const { data } = await query.maybeSingle();
      if (data) {
        setParticipantId(data.id);
        setEventId((current) => current ?? data.event_id);
      }
    }
    void loadParticipant();
  }, [supabase]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
    setFlashSupported(false);
    setFlashOn(false);
  }, []);

  const startCamera = useCallback(async (mode: FacingMode) => {
    setStarting(true);
    setError(null);
    stopCamera();

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("このブラウザはカメラ撮影に対応していません。");
      setStarting(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }

      const track = stream.getVideoTracks()[0];
      const capabilities = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
      setFlashSupported(Boolean(capabilities?.torch));
      setCameraReady(true);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError") {
        setError("カメラの使用が許可されていません。ブラウザ設定からカメラを許可してください。");
      } else if (name === "NotFoundError") {
        setError("使用できるカメラが見つかりませんでした。");
      } else {
        setError("カメラを起動できませんでした。もう一度試してください。");
      }
    } finally {
      setStarting(false);
    }
  }, [stopCamera]);

  useEffect(() => {
    if (stage === "camera" && !capture) void startCamera(facingMode);
    return () => stopCamera();
  }, [stage, capture, facingMode, startCamera, stopCamera]);

  useEffect(() => () => {
    if (capture?.previewUrl) URL.revokeObjectURL(capture.previewUrl);
  }, [capture]);

  async function toggleCamera() {
    const next: FacingMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
  }

  async function toggleFlash() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !flashSupported) return;
    const next = !flashOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setFlashOn(next);
    } catch {
      setError("この端末ではフラッシュを切り替えられませんでした。");
    }
  }

  async function takePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !cameraReady || video.videoWidth === 0 || video.videoHeight === 0) return;

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const scale = Math.min(1, MAX_SIDE / Math.max(sourceWidth, sourceHeight));
    const targetWidth = Math.round(sourceWidth * scale);
    const targetHeight = Math.round(sourceHeight * scale);

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    if (facingMode === "user") {
      ctx.translate(targetWidth, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", WEBP_QUALITY));
    if (!blob) {
      setError("写真の保存に失敗しました。もう一度撮影してください。");
      return;
    }

    const previewUrl = URL.createObjectURL(blob);
    setCapture((previous) => {
      if (previous?.previewUrl) URL.revokeObjectURL(previous.previewUrl);
      return { blob, previewUrl, width: targetWidth, height: targetHeight, compressedBytes: blob.size };
    });
    stopCamera();
  }

  async function retake() {
    setCapture((previous) => {
      if (previous?.previewUrl) URL.revokeObjectURL(previous.previewUrl);
      return null;
    });
    setStage("camera");
  }

  function usePhoto() {
    stopCamera();
    setStage("edit");
  }

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const q = mentionQuery.trim();
      if (!q || !eventId) {
        setMentionOptions([]);
        return;
      }
      const selectedIds = new Set(mentions.map((m) => m.id));
      const { data, error: queryError } = await supabase
        .from("participants")
        .select("id,name")
        .eq("event_id", eventId)
        .eq("is_active", true)
        .ilike("name", `%${q}%`)
        .limit(8);
      if (queryError) {
        setMentionOptions([]);
        return;
      }
      setMentionOptions((data ?? []).filter((p) => p.id !== participantId && !selectedIds.has(p.id)));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [mentionQuery, eventId, participantId, mentions, supabase]);

  function addMention(person: ParticipantOption) {
    setMentions((current) => [...current, person]);
    setMentionQuery("");
    setMentionOptions([]);
  }

  function removeMention(id: string) {
    setMentions((current) => current.filter((m) => m.id !== id));
  }

  async function submitPost() {
  if (!capture) return;

  const params = new URLSearchParams(window.location.search);

  const resolvedMissionId =
    missionId ?? params.get("missionId");

  let resolvedEventId =
    eventId ?? params.get("eventId");

  let resolvedParticipantId = participantId;

  if (!resolvedParticipantId) {
    const { data: authData } = await supabase.auth.getUser();
    const uid = authData.user?.id;

    if (uid) {
      const { data } = await supabase
        .from("participants")
        .select("id,event_id")
        .eq("auth_user_id", uid)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (data) {
        resolvedParticipantId = data.id;
        resolvedEventId = resolvedEventId ?? data.event_id;

        setParticipantId(data.id);
        setEventId((current) => current ?? data.event_id);
      }
    }
  }

  if (
    !resolvedEventId ||
    !resolvedParticipantId ||
    !resolvedMissionId
  ) {
    setError(
      "投稿情報の読み込みが完了していません。数秒待ってもう一度お試しください。"
    );
    return;
  }

  setPosting(true);
    setPosting(true);
    setError(null);
    try {
      const clientRequestId = crypto.randomUUID();
     const filePath = `${resolvedEventId}/${resolvedParticipantId}/${clientRequestId}.webp`;
      const result = await submitPostReliably(supabase, {
        clientRequestId,
       eventId: resolvedEventId,
participantId: resolvedParticipantId,
missionId: resolvedMissionId,
        imagePath: filePath,
        imageBlob: capture.blob,
        comment: comment.trim() || null,
        visibility,
        mentionIds: mentions.map((m) => m.id),
      });

      setPostedId(result.postId);
      setQueuedOffline(result.queued);
      setStage("done");
    } catch (err) {
      const message = err instanceof Error ? err.message : "投稿に失敗しました。通信を確認してもう一度試してください。";
      setError(message);
    } finally {
      setPosting(false);
    }
  }

  return (
    <main className="cameraPage">
      <div className="cameraTopbar">
        <Link href="/missions" className="cameraBack" aria-label="ミッション一覧へ戻る">‹</Link>
        <div><div className="brand">OUTING 2026</div><strong>Photo Mission</strong></div>
      </div>

         {stage === "camera" && (
        <>
          <section className="cameraFrame" aria-label="カメラ">
            {!capture ? (
              <video ref={videoRef} className={`cameraVideo ${facingMode === "user" ? "mirror" : ""}`} autoPlay playsInline muted />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="cameraPreview" src={capture.previewUrl} alt="撮影した写真のプレビュー" />
            )}
            <div className="missionOverlay"><span className="missionOverlayLabel">MISSION</span><strong>{missionTitle}</strong><span>+{missionPoints}pt</span></div>
            {!capture && <div className="cameraControls">
              <button type="button" className={`cameraUtility ${flashOn ? "isOn" : ""}`} onClick={toggleFlash} disabled={!flashSupported || !cameraReady} aria-label="フラッシュ切替">⚡</button>
              <button type="button" className="shutter" onClick={takePhoto} disabled={!cameraReady || starting} aria-label="写真を撮影"><span /></button>
              <button type="button" className="cameraUtility" onClick={toggleCamera} disabled={!cameraReady || starting} aria-label="前後カメラ切替">↻</button>
            </div>}
            {starting && !capture && <div className="cameraStatus">カメラを起動中…</div>}
          </section>

          {capture && <section className="captureReview">
            <div className="compressionInfo"><span>WebP圧縮済み</span><b>{capture.width} × {capture.height}</b><span>{formatBytes(capture.compressedBytes)}</span></div>
            <div className="reviewButtons"><button type="button" className="btn outline" onClick={retake}>↻ 撮り直す</button><button type="button" className="btn primary" onClick={usePhoto}>この写真を使う →</button></div>
          </section>}
          {!capture && !error && <p className="cameraHint">お題を見ながらそのまま撮影できます。画像は長辺1800px・WebP品質82%に自動圧縮されます。</p>}
        </>
      )}

      {stage === "edit" && capture && <section className="postFlow">
        <div className="postPhotoWrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={capture.previewUrl} alt="投稿する写真" className="postPhoto" />
          <div className="postMissionTag"><b>{missionTitle}</b><span>+{missionPoints}pt</span></div>
        </div>

        <div className="postCard">
          <label htmlFor="mentionSearch">メンション <span>任意</span></label>
          <input id="mentionSearch" className="postInput" value={mentionQuery} onChange={(e) => setMentionQuery(e.target.value)} placeholder="名前で検索" autoComplete="off" />
          {mentionOptions.length > 0 && <div className="mentionResults">{mentionOptions.map((person) => <button key={person.id} type="button" onClick={() => addMention(person)}>＋ {person.name}</button>)}</div>}
          {mentions.length > 0 && <div className="mentionChips">{mentions.map((person) => <button type="button" key={person.id} onClick={() => removeMention(person.id)}>@{person.name} ×</button>)}</div>}
        </div>

        <div className="postCard">
          <div className="postLabelRow"><label htmlFor="comment">コメント <span>任意</span></label><small>{comment.length}/{MAX_COMMENT}</small></div>
          <textarea id="comment" className="postInput postTextarea" rows={3} maxLength={MAX_COMMENT} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="ひとこと残そう" />
        </div>

        <button type="button" className="btn primary postNext" onClick={() => setStage("publish")}>次へ</button>
      </section>}

      {stage === "publish" && capture && <section className="postFlow">
        <div className="postCard">
          <h2>公開先を選択</h2>
          <div className="visibilityGrid">
            <button type="button" className={visibility === "stream" ? "selected" : ""} onClick={() => setVisibility("stream")}><b>🌐 Stream</b><span>Stream＋My Galleryに表示</span></button>
            <button type="button" className={visibility === "gallery" ? "selected" : ""} onClick={() => setVisibility("gallery")}><b>🖼️ Galleryのみ</b><span>My Pageだけに表示</span></button>
          </div>
        </div>
        <div className="postCard pointPreview">
          <b>この投稿のポイント</b>
          <p>あなた：+{missionPoints}pt</p>
          {mentions.map((person) => <p key={person.id}>{person.name}：+{missionPoints}pt</p>)}
          <small>初回CLEAR時のみ加点されます。</small>
        </div>
        <div className="reviewButtons">
          <button type="button" className="btn outline" disabled={posting} onClick={() => setStage("edit")}>← 戻る</button>
          <button type="button" className="btn primary" disabled={posting} onClick={submitPost}>{posting ? "投稿中…" : "POSTする"}</button>
        </div>
      </section>}

      {stage === "done" && <section className="postDone">
        <div className="doneCheck">✓</div>
        <h1>{queuedOffline ? "未送信として保存しました" : "Mission CLEAR!"}</h1>
        {!queuedOffline && <div className="donePoints">+{missionPoints}pt</div>}
        <p>{queuedOffline ? "通信が戻ると自動で再送します。二重投稿はされません。" : `写真を${visibility === "stream" ? "StreamとGallery" : "Gallery"}に保存しました。`}</p>
        {postedId && <small>Post ID: {postedId}</small>}
        <Link className="btn primary linkButton doneButton" href="/missions">Mission一覧へ</Link>
      </section>}

      {error && <section className="cameraError" role="alert"><strong>エラー</strong><p>{error}</p>{stage === "camera" && <button type="button" className="btn primary" onClick={() => startCamera(facingMode)}>もう一度試す</button>}</section>}
      <canvas ref={canvasRef} hidden />
    </main>
  );
}
