"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
const WEBP_QUALITY = 0.90;
const MAX_COMMENT = 30;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function MissionCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const supabase = useMemo(() => createClient(), []);

  const [missionTitle, setMissionTitle] =
    useState("Photo Mission");
  const [missionPoints, setMissionPoints] = useState(20);
const [dropNumber, setDropNumber] = useState("01");
  const [missionId, setMissionId] =
    useState<string | null>(null);
  const [eventId, setEventId] =
    useState<string | null>(null);
  const [participantId, setParticipantId] =
    useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("camera");

  const [facingMode, setFacingMode] =
    useState<FacingMode>("environment");
  const [capture, setCapture] =
    useState<CaptureInfo | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flashSupported, setFlashSupported] =
    useState(false);
  const [flashOn, setFlashOn] = useState(false);

  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionOptions, setMentionOptions] = useState<
    ParticipantOption[]
  >([]);
  const [mentions, setMentions] = useState<
    ParticipantOption[]
  >([]);
  const [comment, setComment] = useState("");
  const [visibility, setVisibility] =
    useState<Visibility>("stream");
  const [posting, setPosting] = useState(false);
  const [postedId, setPostedId] =
    useState<string | null>(null);
  const [queuedOffline, setQueuedOffline] =
    useState(false);

  useEffect(() => {
    const params = new URLSearchParams(
      window.location.search,
    );

  const title = params.get("title");
const points = Number(params.get("points"));
const mId = params.get("missionId");
const eId = params.get("eventId");
const drop = params.get("dropNumber");

if (drop) {
  setDropNumber(drop.padStart(2, "0"));
}

    if (title) setMissionTitle(title);

    if (Number.isFinite(points) && points >= 0) {
      setMissionPoints(points);
    }

    if (mId) setMissionId(mId);
    if (eId) setEventId(eId);
  }, []);

  useEffect(() => {
    async function loadParticipant() {
      const { data: authData } =
        await supabase.auth.getUser();

      const uid = authData.user?.id;
      if (!uid) return;

      const { data } = await supabase
        .from("participants")
        .select("id,event_id")
        .eq("auth_user_id", uid)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (data) {
        setParticipantId(data.id);
        setEventId(
          (current) => current ?? data.event_id,
        );
      }
    }

    void loadParticipant();
  }, [supabase]);

  const stopCamera = useCallback(() => {
    streamRef.current
      ?.getTracks()
      .forEach((track) => track.stop());

    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraReady(false);
    setFlashSupported(false);
    setFlashOn(false);
  }, []);

  const startCamera = useCallback(
    async (mode: FacingMode) => {
      setStarting(true);
      setError(null);
      stopCamera();

      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          "このブラウザはカメラ撮影に対応していません。",
        );
        setStarting(false);
        return;
      }

      try {
        const stream =
          await navigator.mediaDevices.getUserMedia({
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

        const capabilities =
          track?.getCapabilities?.() as
            | (MediaTrackCapabilities & {
                torch?: boolean;
              })
            | undefined;

        setFlashSupported(
          Boolean(capabilities?.torch),
        );
        setCameraReady(true);
      } catch (err) {
        const name =
          err instanceof DOMException ? err.name : "";

        if (name === "NotAllowedError") {
          setError(
            "カメラの使用が許可されていません。ブラウザ設定からカメラを許可してください。",
          );
        } else if (name === "NotFoundError") {
          setError(
            "使用できるカメラが見つかりませんでした。",
          );
        } else {
          setError(
            "カメラを起動できませんでした。もう一度試してください。",
          );
        }
      } finally {
        setStarting(false);
      }
    },
    [stopCamera],
  );

  useEffect(() => {
    if (stage === "camera" && !capture) {
      void startCamera(facingMode);
    }

    return () => stopCamera();
  }, [
    stage,
    capture,
    facingMode,
    startCamera,
    stopCamera,
  ]);

  useEffect(
    () => () => {
      if (capture?.previewUrl) {
        URL.revokeObjectURL(capture.previewUrl);
      }
    },
    [capture],
  );

  function toggleCamera() {
    const next: FacingMode =
      facingMode === "environment"
        ? "user"
        : "environment";

    setFacingMode(next);
  }

  async function toggleFlash() {
    const track =
      streamRef.current?.getVideoTracks()[0];

    if (!track || !flashSupported) return;

    const next = !flashOn;

    try {
      await track.applyConstraints({
        advanced: [
          {
            torch: next,
          } as MediaTrackConstraintSet,
        ],
      });

      setFlashOn(next);
    } catch {
      setError(
        "この端末ではフラッシュを切り替えられませんでした。",
      );
    }
  }

  async function chooseLibraryPhoto(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("画像ファイルを選択してください。");
      return;
    }

    setError(null);

    try {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();

      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () =>
          reject(new Error("写真を読み込めませんでした。"));
        image.src = objectUrl;
      });

      const sourceWidth =
        image.naturalWidth || image.width;
      const sourceHeight =
        image.naturalHeight || image.height;

      const scale = Math.min(
        1,
        MAX_SIDE / Math.max(sourceWidth, sourceHeight),
      );

      const targetWidth = Math.round(
        sourceWidth * scale,
      );
      const targetHeight = Math.round(
        sourceHeight * scale,
      );

      const canvas = canvasRef.current;

      if (!canvas) {
        URL.revokeObjectURL(objectUrl);
        throw new Error("写真を処理できませんでした。");
      }

      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const ctx = canvas.getContext("2d", {
        alpha: false,
      });

      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        throw new Error("写真を処理できませんでした。");
      }

      ctx.drawImage(
        image,
        0,
        0,
        targetWidth,
        targetHeight,
      );

      const blob = await new Promise<Blob | null>(
        (resolve) =>
          canvas.toBlob(
            resolve,
            "image/webp",
            WEBP_QUALITY,
          ),
      );

      URL.revokeObjectURL(objectUrl);

      if (!blob) {
        throw new Error("写真の変換に失敗しました。");
      }

      const previewUrl = URL.createObjectURL(blob);

      setCapture((previous) => {
        if (previous?.previewUrl) {
          URL.revokeObjectURL(previous.previewUrl);
        }

        return {
          blob,
          previewUrl,
          width: targetWidth,
          height: targetHeight,
          compressedBytes: blob.size,
        };
      });

      stopCamera();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "写真を読み込めませんでした。",
      );
    }
  }

  async function takePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (
      !video ||
      !canvas ||
      !cameraReady ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      return;
    }

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;

    const scale = Math.min(
      1,
      MAX_SIDE / Math.max(sourceWidth, sourceHeight),
    );

    const targetWidth = Math.round(
      sourceWidth * scale,
    );
    const targetHeight = Math.round(
      sourceHeight * scale,
    );

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d", {
      alpha: false,
    });

    if (!ctx) return;

    if (facingMode === "user") {
      ctx.translate(targetWidth, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(
      video,
      0,
      0,
      targetWidth,
      targetHeight,
    );

    const blob = await new Promise<Blob | null>(
      (resolve) =>
        canvas.toBlob(
          resolve,
          "image/webp",
          WEBP_QUALITY,
        ),
    );

    if (!blob) {
      setError(
        "写真の保存に失敗しました。もう一度撮影してください。",
      );
      return;
    }

    const previewUrl = URL.createObjectURL(blob);

    setCapture((previous) => {
      if (previous?.previewUrl) {
        URL.revokeObjectURL(previous.previewUrl);
      }

      return {
        blob,
        previewUrl,
        width: targetWidth,
        height: targetHeight,
        compressedBytes: blob.size,
      };
    });

    stopCamera();
  }

  function retake() {
    setCapture((previous) => {
      if (previous?.previewUrl) {
        URL.revokeObjectURL(previous.previewUrl);
      }

      return null;
    });

    setError(null);
    setStage("camera");
  }

  function usePhoto() {
    stopCamera();
    setError(null);
    setStage("edit");
  }

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const q = mentionQuery.trim();

      if (!q || !eventId) {
        setMentionOptions([]);
        return;
      }

      const selectedIds = new Set(
        mentions.map((mention) => mention.id),
      );

      const { data, error: queryError } =
        await supabase
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

      setMentionOptions(
        (data ?? []).filter(
          (person) =>
            person.id !== participantId &&
            !selectedIds.has(person.id),
        ),
      );
    }, 220);

    return () => window.clearTimeout(timer);
  }, [
    mentionQuery,
    eventId,
    participantId,
    mentions,
    supabase,
  ]);

  function addMention(person: ParticipantOption) {
    setMentions((current) => [
      ...current,
      person,
    ]);
    setMentionQuery("");
    setMentionOptions([]);
  }

  function removeMention(id: string) {
    setMentions((current) =>
      current.filter(
        (mention) => mention.id !== id,
      ),
    );
  }

  async function submitPost() {
    if (!capture) return;

    const params = new URLSearchParams(
      window.location.search,
    );

    const resolvedMissionId =
      missionId ?? params.get("missionId");

    let resolvedEventId =
      eventId ?? params.get("eventId");

    let resolvedParticipantId = participantId;

    if (!resolvedParticipantId) {
      const { data: authData } =
        await supabase.auth.getUser();

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
          resolvedEventId =
            resolvedEventId ?? data.event_id;

          setParticipantId(data.id);
          setEventId(
            (current) =>
              current ?? data.event_id,
          );
        }
      }
    }

    if (
      !resolvedEventId ||
      !resolvedParticipantId ||
      !resolvedMissionId
    ) {
      setError(
        "投稿情報の読み込みが完了していません。数秒待ってからもう一度試してください。",
      );
      return;
    }

    setPosting(true);
    setError(null);

    try {
      const clientRequestId =
        crypto.randomUUID();

      const filePath =
        `${resolvedEventId}/` +
        `${resolvedParticipantId}/` +
        `${clientRequestId}.webp`;

      const result = await submitPostReliably(
        supabase,
        {
          clientRequestId,
          eventId: resolvedEventId,
          participantId:
            resolvedParticipantId,
          missionId: resolvedMissionId,
          imagePath: filePath,
          imageBlob: capture.blob,
          comment: comment.trim() || null,
          visibility,
          mentionIds: mentions.map(
            (mention) => mention.id,
          ),
        },
      );

      setPostedId(result.postId);
      setQueuedOffline(result.queued);
      setStage("done");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "投稿に失敗しました。通信を確認してもう一度試してください。";

      setError(message);
    } finally {
      setPosting(false);
    }
  }

  return (
    <main
      className="participantUi"
      style={
        {
          minHeight: "100dvh",
          background: "#050509",
          padding: 0,
          overflowX: "hidden",
        } as React.CSSProperties
      }
    >
      {/* =========================
          CAMERA
      ========================= */}

      {stage === "camera" && (
        <section
          aria-label="カメラ"
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 520,
            height: "100dvh",
            margin: "0 auto",
            overflow: "hidden",
            background: "#050509",
          }}
        >
          {/* CAMERA IMAGE */}

          {!capture ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform:
                  facingMode === "user"
                    ? "scaleX(-1)"
                    : undefined,
              }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={capture.previewUrl}
              alt="撮影した写真のプレビュー"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          )}

          {/* CINEMATIC OVERLAY */}

          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: `
                linear-gradient(
                  to bottom,
                  rgba(3,3,8,.72) 0%,
                  rgba(3,3,8,.22) 24%,
                  rgba(3,3,8,.04) 48%,
                  rgba(3,3,8,.22) 68%,
                  rgba(3,3,8,.88) 100%
                )
              `,
            }}
          />

          {/* GRID */}

          {!capture && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                opacity: 0.2,
                backgroundImage: `
                  linear-gradient(
                    to right,
                    transparent 33.15%,
                    rgba(255,255,255,.6) 33.33%,
                    transparent 33.5%,
                    transparent 66.48%,
                    rgba(255,255,255,.6) 66.66%,
                    transparent 66.84%
                  ),
                  linear-gradient(
                    to bottom,
                    transparent 33.15%,
                    rgba(255,255,255,.6) 33.33%,
                    transparent 33.5%,
                    transparent 66.48%,
                    rgba(255,255,255,.6) 66.66%,
                    transparent 66.84%
                  )
                `,
              }}
            />
          )}

          {/* TOP BAR */}

          <div
            style={{
              position: "absolute",
              zIndex: 5,
              top: 0,
              left: 0,
              right: 0,
              padding:
                "max(18px, env(safe-area-inset-top)) 18px 0",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Link
              href="/missions"
              aria-label="Mission一覧へ戻る"
              style={{
                width: 38,
                height: 38,
                display: "grid",
                placeItems: "center",
                borderRadius: "50%",
                color: "#fff",
                textDecoration: "none",
                fontSize: 24,
                fontWeight: 300,
                background: "rgba(7,7,12,.38)",
                border:
                  "1px solid rgba(255,255,255,.15)",
                backdropFilter: "blur(14px)",
              }}
            >
              ×
            </Link>

            <div
              className="outingSerifEn"
              style={{
                color: "#fff",
                fontSize: 16,
                fontWeight: 500,
                letterSpacing: ".14em",
                textShadow:
                  "0 2px 12px rgba(0,0,0,.55)",
              }}
            >
              OUTING 2026
            </div>

            <div
              style={{
                width: 38,
                height: 38,
              }}
            />
          </div>

          {/* MISSION GLASS CARD */}

          <div
            style={{
              position: "absolute",
              zIndex: 5,
              top: "max(82px, calc(env(safe-area-inset-top) + 64px))",
              left: 16,
              right: 16,
              padding: "15px 16px 16px",
              borderRadius: 13,
              background:
                "linear-gradient(135deg, rgba(12,11,20,.67), rgba(9,8,15,.38))",
              border:
                "1px solid rgba(255,255,255,.16)",
              backdropFilter: "blur(16px)",
              boxShadow:
                "0 15px 45px rgba(0,0,0,.20)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <span
                className="outingSerifEn"
                style={{
                  color:
                    "rgba(255,255,255,.62)",
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: ".18em",
                }}
              >
                DROP {dropNumber}
              </span>

              <span
                className="outingSerifEn"
                style={{
                  color: "#dacaff",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: ".08em",
                }}
              >
                +{missionPoints} PT
              </span>
            </div>

            <h1
              className="outingSerifJa"
              style={{
                margin: "8px 0 0",
                maxWidth: "90%",
                color: "#fff",
                fontSize: 22,
                fontWeight: 400,
                lineHeight: 1.45,
                textShadow:
                  "0 2px 14px rgba(0,0,0,.35)",
              }}
            >
              {missionTitle}
            </h1>

            <p
              className="outingSans"
              style={{
                margin: "7px 0 0",
                color:
                  "rgba(255,255,255,.52)",
                fontSize: 10,
                letterSpacing: ".04em",
              }}
            >
              PHOTO MISSION
            </p>
          </div>

          {/* CAMERA STARTING */}

          {starting && !capture && (
            <div
              className="outingSans"
              style={{
                position: "absolute",
                zIndex: 6,
                left: "50%",
                top: "50%",
                transform:
                  "translate(-50%, -50%)",
                padding: "9px 14px",
                borderRadius: 999,
                color: "#fff",
                fontSize: 11,
                background:
                  "rgba(5,5,10,.55)",
                backdropFilter: "blur(12px)",
              }}
            >
              カメラを起動中...
            </div>
          )}

          <input
            ref={libraryInputRef}
            type="file"
            accept="image/*"
            onChange={chooseLibraryPhoto}
            style={{ display: "none" }}
          />

          {/* CAMERA CONTROLS */}

          {!capture && (
            <div
              style={{
                position: "absolute",
                zIndex: 6,
                left: 0,
                right: 0,
                bottom:
                  "max(31px, calc(env(safe-area-inset-bottom) + 20px))",
                display: "grid",
                gridTemplateColumns:
                  "1fr 110px 1fr",
                alignItems: "center",
                padding: "0 28px",
              }}
            >
              {/* PHOTO LIBRARY */}

              <button
                type="button"
                onClick={() =>
                  libraryInputRef.current?.click()
                }
                aria-label="フォトライブラリから選択"
                style={{
                  justifySelf: "center",
                  width: 48,
                  height: 48,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 12,
                  border:
                    "1px solid rgba(255,255,255,.18)",
                  background:
                    "rgba(8,8,13,.48)",
                  color: "#fff",
                  backdropFilter: "blur(12px)",
                  cursor: "pointer",
                  fontSize: 21,
                }}
              >
                ▣
              </button>

              {/* SHUTTER */}

              <button
                type="button"
                onClick={takePhoto}
                disabled={
                  !cameraReady || starting
                }
                aria-label="写真を撮影"
                style={{
                  justifySelf: "center",
                  width: 82,
                  height: 82,
                  padding: 5,
                  borderRadius: "50%",
                  border:
                    "2px solid rgba(255,255,255,.92)",
                  background:
                    "rgba(255,255,255,.08)",
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                  opacity:
                    !cameraReady || starting
                      ? 0.5
                      : 1,
                  boxShadow:
                    "0 6px 28px rgba(0,0,0,.25)",
                }}
              >
                <span
                  style={{
                    width: 66,
                    height: 66,
                    display: "block",
                    borderRadius: "50%",
                    background: "#fff",
                  }}
                />
              </button>

              {/* SWITCH CAMERA */}

              <button
                type="button"
                onClick={toggleCamera}
                disabled={
                  !cameraReady || starting
                }
                aria-label="前後カメラ切替"
                style={{
                  justifySelf: "center",
                  width: 44,
                  height: 44,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: "50%",
                  border:
                    "1px solid rgba(255,255,255,.18)",
                  background:
                    "rgba(8,8,13,.48)",
                  color: "#fff",
                  backdropFilter: "blur(12px)",
                  cursor: "pointer",
                  opacity:
                    !cameraReady || starting
                      ? 0.35
                      : 1,
                  fontSize: 20,
                }}
              >
                ↻
              </button>
            </div>
          )}

          {/* CAPTURE REVIEW */}

          {capture && (
            <div
              style={{
                position: "absolute",
                zIndex: 7,
                left: 16,
                right: 16,
                bottom:
                  "max(24px, calc(env(safe-area-inset-bottom) + 16px))",
              }}
            >
              <div
                style={{
                  padding: "14px 15px",
                  marginBottom: 10,
                  borderRadius: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent:
                    "space-between",
                  gap: 10,
                  color:
                    "rgba(255,255,255,.65)",
                  fontSize: 10,
                  background:
                    "rgba(8,8,14,.58)",
                  border:
                    "1px solid rgba(255,255,255,.13)",
                  backdropFilter: "blur(14px)",
                }}
              >
                <span>WebP</span>

                <span>
                  {capture.width} ×{" "}
                  {capture.height}
                </span>

                <span>
                  {formatBytes(
                    capture.compressedBytes,
                  )}
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "1fr 1.45fr",
                  gap: 9,
                }}
              >
                <button
                  type="button"
                  onClick={retake}
                  className="outingSans"
                  style={{
                    minHeight: 52,
                    borderRadius: 12,
                    border:
                      "1px solid rgba(255,255,255,.18)",
                    background:
                      "rgba(8,8,14,.58)",
                    color: "#fff",
                    backdropFilter:
                      "blur(14px)",
                    fontWeight: 600,
                  }}
                >
                  撮り直す
                </button>

                <button
                  type="button"
                  onClick={usePhoto}
                  className="outingSans"
                  style={{
                    minHeight: 52,
                    borderRadius: 12,
                    border:
                      "1px solid rgba(190,165,255,.25)",
                    background:
                      "linear-gradient(135deg,#7956d8,#6441c4)",
                    color: "#fff",
                    fontWeight: 700,
                    boxShadow:
                      "0 12px 30px rgba(89,54,175,.30)",
                  }}
                >
                  この写真を使う →
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* =========================
          EDIT
      ========================= */}

      {stage === "edit" && capture && (
        <section
          className="participantContent"
          style={{
            paddingTop: 18,
            paddingBottom: 40,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <button
              type="button"
              onClick={retake}
              aria-label="撮り直す"
              style={{
                width: 38,
                height: 38,
                display: "grid",
                placeItems: "center",
                borderRadius: "50%",
                border:
                  "1px solid rgba(255,255,255,.13)",
                background:
                  "rgba(255,255,255,.06)",
                color: "#fff",
                fontSize: 18,
              }}
            >
              ←
            </button>

            <div>
              <p
                className="outingSerifEn"
                style={{
                  margin: 0,
                  color:
                    "rgba(255,255,255,.48)",
                  fontSize: 9,
                  letterSpacing: ".18em",
                }}
              >
                DROP {dropNumber}
              </p>

              <strong
                className="outingSerifEn"
                style={{
                  display: "block",
                  marginTop: 3,
                  color: "#fff",
                  fontSize: 17,
                  letterSpacing: ".10em",
                }}
              >
                EDIT PHOTO
              </strong>
            </div>
          </div>

          <div
            style={{
              position: "relative",
              overflow: "hidden",
              borderRadius: 14,
              border:
                "1px solid rgba(255,255,255,.10)",
              boxShadow:
                "0 18px 45px rgba(0,0,0,.25)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={capture.previewUrl}
              alt="投稿する写真"
              style={{
                width: "100%",
                maxHeight: "48dvh",
                objectFit: "cover",
                display: "block",
              }}
            />

            <div
              style={{
                position: "absolute",
                left: 12,
                right: 12,
                bottom: 12,
                padding: "11px 12px",
                borderRadius: 10,
                background:
                  "rgba(7,7,12,.62)",
                border:
                  "1px solid rgba(255,255,255,.13)",
                backdropFilter: "blur(12px)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  gap: 10,
                }}
              >
                <b
                  className="outingSerifJa"
                  style={{
                    color: "#fff",
                    fontWeight: 400,
                  }}
                >
                  {missionTitle}
                </b>

                <span
                  className="outingSerifEn"
                  style={{
                    color: "#dacaff",
                    fontSize: 11,
                  }}
                >
                  +{missionPoints} PT
                </span>
              </div>
            </div>
          </div>

          <div
            className="glassCardStrong"
            style={{
              padding: 16,
              marginTop: 12,
            }}
          >
            <label
              htmlFor="mentionSearch"
              className="outingSans"
              style={{
                display: "block",
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 9,
              }}
            >
              メンション{" "}
              <span
                style={{
                  color:
                    "rgba(255,255,255,.42)",
                  fontWeight: 400,
                }}
              >
                任意
              </span>
            </label>

            <input
              id="mentionSearch"
              className="postInput"
              value={mentionQuery}
              onChange={(e) =>
                setMentionQuery(
                  e.target.value,
                )
              }
              placeholder="名前で検索"
              autoComplete="off"
            />

            {mentionOptions.length > 0 && (
              <div className="mentionResults">
                {mentionOptions.map(
                  (person) => (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() =>
                        addMention(person)
                      }
                    >
                      ＋ {person.name}
                    </button>
                  ),
                )}
              </div>
            )}

            {mentions.length > 0 && (
              <div className="mentionChips">
                {mentions.map(
                  (person) => (
                    <button
                      type="button"
                      key={person.id}
                      onClick={() =>
                        removeMention(
                          person.id,
                        )
                      }
                    >
                      @{person.name} ×
                    </button>
                  ),
                )}
              </div>
            )}
          </div>

          <div
            className="glassCardStrong"
            style={{
              padding: 16,
              marginTop: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent:
                  "space-between",
                marginBottom: 9,
              }}
            >
              <label
                htmlFor="comment"
                className="outingSans"
                style={{
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                コメント{" "}
                <span
                  style={{
                    color:
                      "rgba(255,255,255,.42)",
                    fontWeight: 400,
                  }}
                >
                  任意
                </span>
              </label>

              <small
                style={{
                  color:
                    "rgba(255,255,255,.42)",
                }}
              >
                {comment.length}/{MAX_COMMENT}
              </small>
            </div>

            <textarea
              id="comment"
              className="postInput postTextarea"
              rows={3}
              maxLength={MAX_COMMENT}
              value={comment}
              onChange={(e) =>
                setComment(e.target.value)
              }
              placeholder="ひとこと残そう"
            />
          </div>

          <button
            type="button"
            className="uiPrimaryButton outingSans"
            onClick={() =>
              setStage("publish")
            }
            style={{
              width: "100%",
              justifyContent: "center",
              marginTop: 14,
              minHeight: 52,
            }}
          >
            次へ →
          </button>
        </section>
      )}

      {/* =========================
          PUBLISH
      ========================= */}

      {stage === "publish" && capture && !posting && (
        <section
          className="participantContent"
          style={{
            paddingTop: 26,
            paddingBottom: 40,
          }}
        >
          <p
            className="outingSerifEn"
            style={{
              margin: 0,
              color:
                "rgba(255,255,255,.48)",
              fontSize: 10,
              letterSpacing: ".18em",
            }}
          >
            OUTING 2026
          </p>

          <h1
            className="outingSerifEn"
            style={{
              margin: "8px 0 22px",
              color: "#fff",
              fontSize: 27,
              fontWeight: 500,
              letterSpacing: ".12em",
            }}
          >
            PUBLISH
          </h1>

          <div
            className="glassCardStrong"
            style={{
              padding: 16,
            }}
          >
            <h2
              className="outingSerifJa"
              style={{
                margin: "0 0 14px",
                color: "#fff",
                fontSize: 17,
                fontWeight: 400,
              }}
            >
              公開先を選択
            </h2>

            <div
              style={{
                display: "grid",
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setVisibility("stream")
                }
                style={{
                  padding: 15,
                  textAlign: "left",
                  borderRadius: 11,
                  border:
                    visibility === "stream"
                      ? "1px solid rgba(184,157,255,.52)"
                      : "1px solid rgba(255,255,255,.10)",
                  background:
                    visibility === "stream"
                      ? "rgba(113,72,215,.24)"
                      : "rgba(255,255,255,.05)",
                  color: "#fff",
                }}
              >
                <b
                  className="outingSans"
                  style={{
                    display: "block",
                    fontSize: 13,
                  }}
                >
                  Stream
                </b>

                <span
                  className="outingSans"
                  style={{
                    display: "block",
                    marginTop: 5,
                    color:
                      "rgba(255,255,255,.48)",
                    fontSize: 10,
                  }}
                >
                  StreamとMy Galleryに表示
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setVisibility("gallery")
                }
                style={{
                  padding: 15,
                  textAlign: "left",
                  borderRadius: 11,
                  border:
                    visibility === "gallery"
                      ? "1px solid rgba(184,157,255,.52)"
                      : "1px solid rgba(255,255,255,.10)",
                  background:
                    visibility === "gallery"
                      ? "rgba(113,72,215,.24)"
                      : "rgba(255,255,255,.05)",
                  color: "#fff",
                }}
              >
                <b
                  className="outingSans"
                  style={{
                    display: "block",
                    fontSize: 13,
                  }}
                >
                  Galleryのみ
                </b>

                <span
                  className="outingSans"
                  style={{
                    display: "block",
                    marginTop: 5,
                    color:
                      "rgba(255,255,255,.48)",
                    fontSize: 10,
                  }}
                >
                  My Pageだけに表示
                </span>
              </button>
            </div>
          </div>

          <div
            className="glassCardStrong"
            style={{
              padding: 16,
              marginTop: 10,
            }}
          >
            <p
              className="outingSerifEn"
              style={{
                margin: 0,
                color:
                  "rgba(255,255,255,.48)",
                fontSize: 9,
                letterSpacing: ".15em",
              }}
            >
              MISSION POINTS
            </p>

            <div
              className="outingSerifEn"
              style={{
                marginTop: 7,
                color: "#dacaff",
                fontSize: 28,
              }}
            >
              +{missionPoints} PT
            </div>

            {mentions.map((person) => (
              <p
                key={person.id}
                className="outingSans"
                style={{
                  margin: "7px 0 0",
                  color:
                    "rgba(255,255,255,.58)",
                  fontSize: 11,
                }}
              >
                {person.name}：+
                {missionPoints} PT
              </p>
            ))}

            <small
              className="outingSans"
              style={{
                display: "block",
                marginTop: 12,
                color:
                  "rgba(255,255,255,.38)",
              }}
            >
              初回CLEAR時のみ加点されます。
            </small>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "1fr 1.4fr",
              gap: 9,
              marginTop: 14,
            }}
          >
            <button
              type="button"
              className="uiGhostButton"
              disabled={posting}
              onClick={() =>
                setStage("edit")
              }
              style={{
                justifyContent: "center",
              }}
            >
              ← 戻る
            </button>

            <button
              type="button"
              className="uiPrimaryButton"
              disabled={posting}
              onClick={submitPost}
              style={{
                justifyContent: "center",
              }}
            >
              {posting
                ? "投稿中..."
                : "POSTする"}
            </button>
          </div>
        </section>
      )}

      {/* =========================
          UPLOADING
      ========================= */}

      {stage === "publish" && capture && posting && (
        <section
          className="participantContent"
          aria-live="polite"
          aria-busy="true"
          style={{
            minHeight: "100dvh",
            display: "grid",
            placeItems: "center",
            paddingTop: 30,
            paddingBottom: 30,
          }}
        >
          <div
            className="glassCardStrong"
            style={{
              width: "100%",
              padding: "48px 22px",
              textAlign: "center",
            }}
          >
            <p
              className="outingSerifEn"
              style={{
                margin: 0,
                color: "rgba(255,255,255,.44)",
                fontSize: 9,
                letterSpacing: ".20em",
              }}
            >
              OUTING 2026
            </p>

            <div
              aria-hidden="true"
              style={{
                width: 64,
                height: 64,
                margin: "28px auto 0",
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  border: "1px solid rgba(190,165,255,.18)",
                }}
              />
              <div
                className="outingUploadSpinner"
                style={{
                  position: "absolute",
                  inset: 5,
                  borderRadius: "50%",
                  border: "2px solid rgba(218,202,255,.16)",
                  borderTopColor: "#dacaff",
                }}
              />
            </div>

            <h1
              className="outingSerifEn"
              style={{
                margin: "24px 0 0",
                color: "#fff",
                fontSize: 29,
                fontWeight: 500,
                letterSpacing: ".10em",
              }}
            >
              UPLOADING
            </h1>

            <p
              className="outingSans"
              style={{
                margin: "17px auto 0",
                maxWidth: 310,
                color: "rgba(255,255,255,.68)",
                fontSize: 13,
                lineHeight: 1.8,
              }}
            >
              写真を送信しています…
            </p>

            <p
              className="outingSans"
              style={{
                margin: "5px auto 0",
                color: "rgba(255,255,255,.36)",
                fontSize: 10,
                lineHeight: 1.7,
              }}
            >
              画面を閉じずにお待ちください
            </p>

            <style jsx>{`
              @keyframes outingUploadSpin {
                to {
                  transform: rotate(360deg);
                }
              }
              .outingUploadSpinner {
                animation: outingUploadSpin 0.85s linear infinite;
              }
              @media (prefers-reduced-motion: reduce) {
                .outingUploadSpinner {
                  animation-duration: 2s;
                }
              }
            `}</style>
          </div>
        </section>
      )}

      {/* =========================
          DONE
      ========================= */}

      {stage === "done" && (
        <section
          className="participantContent"
          style={{
            minHeight: "100dvh",
            display: "grid",
            placeItems: "center",
            paddingTop: 30,
            paddingBottom: 30,
          }}
        >
          <div
            className="glassCardStrong"
            style={{
              width: "100%",
              padding: "42px 22px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 58,
                height: 58,
                margin: "0 auto",
                display: "grid",
                placeItems: "center",
                borderRadius: "50%",
                border:
                  "1px solid rgba(190,165,255,.32)",
                background:
                  "rgba(113,72,215,.20)",
                color: "#dacaff",
                fontSize: 25,
              }}
            >
              ✓
            </div>

            <p
              className="outingSerifEn"
              style={{
                margin: "22px 0 0",
                color:
                  "rgba(255,255,255,.44)",
                fontSize: 9,
                letterSpacing: ".20em",
              }}
            >
              OUTING 2026
            </p>

            <h1
              className="outingSerifEn"
              style={{
                margin: "8px 0 0",
                color: "#fff",
                fontSize: 29,
                fontWeight: 500,
                letterSpacing: ".08em",
              }}
            >
              {queuedOffline
                ? "SAVED"
                : "MISSION CLEAR"}
            </h1>

            {!queuedOffline && (
              <div
                className="outingSerifEn"
                style={{
                  marginTop: 12,
                  color: "#dacaff",
                  fontSize: 34,
                }}
              >
                +{missionPoints} PT
              </div>
            )}

            <p
              className="outingSans"
              style={{
                margin: "18px auto 0",
                maxWidth: 310,
                color:
                  "rgba(255,255,255,.56)",
                fontSize: 12,
                lineHeight: 1.8,
              }}
            >
              {queuedOffline
                ? "通信が戻ると自動で再送します。二重投稿はされません。"
                : `写真を${
                    visibility === "stream"
                      ? "StreamとGallery"
                      : "Gallery"
                  }に保存しました。`}
            </p>

            {postedId && (
              <small
                style={{
                  display: "block",
                  marginTop: 14,
                  color:
                    "rgba(255,255,255,.25)",
                  fontSize: 8,
                }}
              >
                Post ID: {postedId}
              </small>
            )}

            <Link
              href="/missions"
              className="uiPrimaryButton"
              style={{
                marginTop: 24,
                width: "100%",
                display: "inline-flex",
                justifyContent: "center",
                textDecoration: "none",
              }}
            >
              Mission一覧へ
            </Link>
          </div>
        </section>
      )}

      {/* =========================
          ERROR
      ========================= */}

      {error && (
        <section
          role="alert"
          style={{
            position:
              stage === "camera"
                ? "fixed"
                : "relative",
            zIndex: 30,
            left:
              stage === "camera"
                ? 16
                : undefined,
            right:
              stage === "camera"
                ? 16
                : undefined,
            bottom:
              stage === "camera"
                ? 145
                : undefined,
            maxWidth:
              stage === "camera"
                ? 488
                : undefined,
            margin:
              stage === "camera"
                ? "0 auto"
                : "16px",
            padding: 14,
            borderRadius: 12,
            background:
              "rgba(45,12,18,.88)",
            border:
              "1px solid rgba(255,120,140,.22)",
            color: "#fff",
            backdropFilter: "blur(14px)",
          }}
        >
          <strong
            className="outingSans"
            style={{
              fontSize: 12,
            }}
          >
            エラー
          </strong>

          <p
            className="outingSans"
            style={{
              margin: "5px 0 0",
              fontSize: 11,
              lineHeight: 1.6,
              color:
                "rgba(255,255,255,.72)",
            }}
          >
            {error}
          </p>

          {stage === "camera" && (
            <button
              type="button"
              className="uiPrimaryButton"
              onClick={() =>
                void startCamera(facingMode)
              }
              style={{
                marginTop: 10,
              }}
            >
              もう一度試す
            </button>
          )}
        </section>
      )}

      <canvas ref={canvasRef} hidden />
    </main>
  );
}