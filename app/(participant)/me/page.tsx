'use client'

import Link from 'next/link'
import Cropper, { Area } from 'react-easy-crop'
import {
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  HomeIcon,
  Images,
  ImageUp,
  Target,
  Trophy,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import {
  ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import LivePosts from '@/components/LivePosts'
import { createClient } from '@/lib/supabase/client'

async function createCroppedImage(
  imageSrc: string,
  crop: Area,
) {
  const image = new Image()
  image.src = imageSrc

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () =>
      reject(new Error('画像を読み込めませんでした'))
  })

  const canvas = document.createElement('canvas')
  const size = Math.min(
    1024,
    Math.max(crop.width, crop.height),
  )

  canvas.width = size
  canvas.height = size

  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error(
      '画像を処理できませんでした',
    )
  }

  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    size,
    size,
  )

  return await new Promise<Blob>(
    (resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(
              new Error(
                '画像を保存できませんでした',
              ),
            )
          }
        },
        'image/jpeg',
        0.9,
      )
    },
  )
}

export default function Me() {
  const supabase = useMemo(
    () => createClient(),
    [],
  )

  const galleryInputRef =
    useRef<HTMLInputElement | null>(null)

  const cameraInputRef =
    useRef<HTMLInputElement | null>(null)

  const [showRank, setShowRank] =
    useState(false)

  const [name, setName] =
    useState('My Page')

  const [score, setScore] =
    useState(0)

  const [connections, setConnections] =
    useState(0)

  const [rank, setRank] =
    useState<number | null>(null)

  const [participantId, setParticipantId] =
    useState<string | null>(null)

  const [eventId, setEventId] =
    useState<string | null>(null)

  const [avatarUrl, setAvatarUrl] =
    useState<string | null>(null)

  const [avatarUploading, setAvatarUploading] =
    useState(false)

  const [showAvatarMenu, setShowAvatarMenu] =
    useState(false)

  const [cropImage, setCropImage] =
    useState<string | null>(null)

  const [crop, setCrop] = useState({
    x: 0,
    y: 0,
  })

  const [zoom, setZoom] =
    useState(1)

  const [
    croppedAreaPixels,
    setCroppedAreaPixels,
  ] = useState<Area | null>(null)

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const { data: participant } =
        await supabase
          .from('participants')
          .select(
            'id,event_id,name,avatar_path',
          )
          .eq('auth_user_id', user.id)
          .maybeSingle()

      if (!participant) return

      setParticipantId(participant.id)
      setEventId(participant.event_id)
      setName(participant.name)

      if (participant.avatar_path) {
        const { data } =
          await supabase.storage
            .from('outing-photos')
            .createSignedUrl(
              participant.avatar_path,
              60 * 60,
            )

        setAvatarUrl(
          data?.signedUrl ?? null,
        )
      }

      const { data: points } =
        await supabase
          .from('point_transactions')
          .select('points')
          .eq(
            'participant_id',
            participant.id,
          )
          .eq('is_active', true)

      setScore(
        (points ?? []).reduce(
          (sum, item) =>
            sum + (item.points ?? 0),
          0,
        ),
      )

      const { count: a } =
        await supabase
          .from('connections')
          .select('*', {
            count: 'exact',
            head: true,
          })
          .eq(
            'participant_a_id',
            participant.id,
          )

      const { count: b } =
        await supabase
          .from('connections')
          .select('*', {
            count: 'exact',
            head: true,
          })
          .eq(
            'participant_b_id',
            participant.id,
          )

      setConnections(
        (a ?? 0) + (b ?? 0),
      )

      const { data: rankData } =
        await supabase.rpc(
          'get_my_rank',
          {
            p_event_id:
              participant.event_id,
          },
        )

      if (
        Array.isArray(rankData) &&
        rankData[0]?.rank
      ) {
        setRank(
          Number(rankData[0].rank),
        )
      }
    })()
  }, [supabase])

  function selectAvatar(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file =
      event.target.files?.[0]

    if (!file) return

    if (!file.type.startsWith('image/')) {
      alert(
        '画像ファイルを選択してください。',
      )
      return
    }

    if (cropImage) {
      URL.revokeObjectURL(cropImage)
    }

    const objectUrl =
      URL.createObjectURL(file)

    setCropImage(objectUrl)
    setCrop({
      x: 0,
      y: 0,
    })
    setZoom(1)
    setCroppedAreaPixels(null)
    setShowAvatarMenu(false)

    event.target.value = ''
  }

  function closeCropper() {
    if (cropImage) {
      URL.revokeObjectURL(cropImage)
    }

    setCropImage(null)
    setCroppedAreaPixels(null)
    setZoom(1)
  }

  async function saveAvatar() {
    if (
      !cropImage ||
      !croppedAreaPixels ||
      !participantId ||
      !eventId
    ) {
      return
    }

    setAvatarUploading(true)

    try {
      const blob =
        await createCroppedImage(
          cropImage,
          croppedAreaPixels,
        )

      const path =
        `avatars/${participantId}/avatar.jpg`

      const { error: uploadError } =
        await supabase.storage
          .from('outing-photos')
          .upload(path, blob, {
            upsert: true,
            contentType: 'image/jpeg',
            cacheControl: '3600',
          })

      if (uploadError) {
        throw uploadError
      }

      /*
       * avatar_path を参加者本人に保存。
       * set_my_avatar RPC がある場合は
       * そちらを優先する。
       */
      const { error: rpcError } =
        await supabase.rpc(
          'set_my_avatar',
          {
            p_event_id: eventId,
            p_avatar_path: path,
          },
        )

      if (rpcError) {
        /*
         * RPC未作成の場合にも動かせるよう
         * participants UPDATEへフォールバック。
         */
        const { error: updateError } =
          await supabase
            .from('participants')
            .update({
              avatar_path: path,
            })
            .eq('id', participantId)

        if (updateError) {
          throw updateError
        }
      }

      const { data, error: urlError } =
        await supabase.storage
          .from('outing-photos')
          .createSignedUrl(
            path,
            60 * 60,
          )

      if (urlError) {
        throw urlError
      }

      setAvatarUrl(
        data?.signedUrl
          ? `${data.signedUrl}&v=${Date.now()}`
          : null,
      )

      closeCropper()
    } catch (error) {
      console.error(error)

      alert(
        error instanceof Error
          ? error.message
          : 'プロフィール写真を保存できませんでした。',
      )
    } finally {
      setAvatarUploading(false)
    }
  }

  const initial =
    name && name !== 'My Page'
      ? name.slice(0, 1)
      : 'M'

  return (
    <main
      className="participantUi"
      style={
        {
          '--participant-bg-image':
            'url("/outing-bg.jpg")',
        } as React.CSSProperties
      }
    >
      <div className="participantContent">
        
{/* HEADER */}
<header
  style={{
    paddingTop: 18,
    marginBottom: 24,
  }}
>
  <p
    className="outingSerifEn"
    style={{
      margin: 0,
      color: 'rgba(255,255,255,.58)',
      fontSize: 11,
      fontWeight: 500,
      letterSpacing: '.18em',
    }}
  >
    OUTING 2026
  </p>

  <h1
    className="outingSerifEn"
    style={{
      margin: '7px 0 0',
      color: '#fff',
      fontSize: 34,
      fontWeight: 500,
      lineHeight: 1,
      letterSpacing: '.14em',
    }}
  >
    MY PAGE
  </h1>
</header>

        {/* PROFILE */}
        <section
          className="glassCard"
          style={{
            padding: 20,
            background:
              'rgba(15, 17, 24, .52)',
            backdropFilter:
              'blur(18px)',
            WebkitBackdropFilter:
              'blur(18px)',
            border:
              '1px solid rgba(255,255,255,.10)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <button
              type="button"
              onClick={() =>
                setShowAvatarMenu(true)
              }
              disabled={avatarUploading}
              className="uiAvatar"
              style={{
                width: 64,
                height: 64,
                padding: 0,
                overflow: 'hidden',
                border: 0,
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
                fontSize: 22,
                fontWeight: 800,
                cursor: 'pointer',
                opacity:
                  avatarUploading
                    ? 0.55
                    : 1,
              }}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="プロフィール写真"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              ) : (
                initial
              )}
            </button>

            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              onChange={selectAvatar}
              style={{
                display: 'none',
              }}
            />

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="user"
              onChange={selectAvatar}
              style={{
                display: 'none',
              }}
            />

           <div
  style={{
    minWidth: 0,
  }}
>
  <p
    className="outingSerifEn"
    style={{
      margin: '0 0 5px',
      color: 'rgba(255,255,255,.48)',
      fontSize: 10,
      fontWeight: 500,
      letterSpacing: '.16em',
    }}
  >
    PARTICIPANT
  </p>

  <h2
    className="outingSerifJa"
    style={{
      margin: 0,
      color: '#fff',
      fontSize: 22,
      lineHeight: 1.35,
      fontWeight: 500,
      letterSpacing: '.04em',
    }}
  >
    {name}
  </h2>

  <p
    className="outingSans"
    style={{
      margin: '5px 0 0',
      color: 'rgba(255,255,255,.38)',
      fontSize: 10,
    }}
  >
    写真をタップして変更
  </p>
</div>
</div>

          {/* STATS */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(2, minmax(0, 1fr))',
              gap: 10,
              marginTop: 20,
            }}
          >
            <div
              style={{
                padding: '15px 14px',
                borderRadius: 16,
                background:
                  'rgba(255,255,255,.045)',
                border:
                  '1px solid rgba(255,255,255,.07)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color:
                    'rgba(255,255,255,.45)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing:
                    '.08em',
                }}
              >
                <Trophy size={13} />
                SCORE
              </div>

              <strong
                style={{
                  display: 'block',
                  marginTop: 7,
                  color: '#fff',
                  fontSize: 28,
                  lineHeight: 1,
                }}
              >
                {score}
                <span
                  style={{
                    marginLeft: 3,
                    color:
                      'rgba(255,255,255,.42)',
                    fontSize: 11,
                  }}
                >
                  PT
                </span>
              </strong>
            </div>

            <div
              style={{
                padding: '15px 14px',
                borderRadius: 16,
                background:
                  'rgba(255,255,255,.045)',
                border:
                  '1px solid rgba(255,255,255,.07)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color:
                    'rgba(255,255,255,.45)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing:
                    '.08em',
                }}
              >
                <UsersRound size={13} />
                CONNECTIONS
              </div>

              <strong
                style={{
                  display: 'block',
                  marginTop: 7,
                  color: '#fff',
                  fontSize: 28,
                  lineHeight: 1,
                }}
              >
                {connections}
              </strong>
            </div>
          </div>

          {/* RANK */}
          <button
            type="button"
            onClick={() =>
              setShowRank(
                (value) => !value,
              )
            }
            style={{
              width: '100%',
              marginTop: 12,
              padding: '12px 13px',
              borderRadius: 14,
              border:
                '1px solid rgba(255,255,255,.08)',
              background:
                'rgba(255,255,255,.035)',
              color:
                'rgba(255,255,255,.72)',
              display: 'flex',
              alignItems: 'center',
              justifyContent:
                'space-between',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
              }}
            >
              <Trophy size={15} />
              自分のランキング
            </span>

            {showRank ? (
              <ChevronUp size={16} />
            ) : (
              <ChevronDown size={16} />
            )}
          </button>

          {showRank && (
            <div
              style={{
                marginTop: 10,
                padding: '15px 14px',
                borderRadius: 14,
                background:
                  'rgba(139,92,246,.10)',
                border:
                  '1px solid rgba(167,139,250,.13)',
              }}
            >
              <span
                style={{
                  color:
                    'rgba(255,255,255,.48)',
                  fontSize: 10,
                  letterSpacing:
                    '.08em',
                }}
              >
                CURRENT RANK
              </span>

              <div
                style={{
                  marginTop: 5,
                  color: '#fff',
                  fontSize: 17,
                  fontWeight: 750,
                }}
              >
                {rank
                  ? `${rank}位`
                  : '集計中'}

                <span
                  style={{
                    marginLeft: 8,
                    color: '#b9a4ff',
                    fontSize: 12,
                  }}
                >
                  {score} PT
                </span>
              </div>
            </div>
          )}
        </section>

        {/* GALLERY */}
        <section
          style={{
            marginTop: 32,
            paddingBottom: 120,
          }}
        >

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent:
                'space-between',
              marginBottom: 14,
            }}
          >
            <div>
              <p
                className="outingSerifEn"
                style={{
                  margin: 0,
                  color: 'rgba(255,255,255,.48)',
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: '.16em',
                }}
              >
                YOUR MOMENTS
              </p>

              <h2
                className="outingSerifEn"
                style={{
                  margin: '5px 0 0',
                  color: '#fff',
                  fontSize: 24,
                  fontWeight: 500,
                  lineHeight: 1,
                  letterSpacing: '.08em',
                }}
              >
                MY GALLERY
              </h2>
            </div>

            <Images
              size={20}
              style={{
                color:
                  'rgba(255,255,255,.45)',
              }}
            />
          </div>

          <LivePosts mode="gallery" />
        </section>
      </div>

      {/* AVATAR ACTION SHEET */}
      {showAvatarMenu && !cropImage && (
        <div
          onClick={() =>
            setShowAvatarMenu(false)
          }
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background:
              'rgba(0,0,0,.58)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(event) =>
              event.stopPropagation()
            }
            style={{
              width: '100%',
              maxWidth: 500,
              padding: 10,
              borderRadius: 24,
              background:
                'rgba(23,24,31,.92)',
              border:
                '1px solid rgba(255,255,255,.10)',
              boxShadow:
                '0 20px 60px rgba(0,0,0,.45)',
            }}
          >
            <div
              style={{
                padding: '12px 12px 10px',
              }}
            >
              <p
                style={{
                  margin: 0,
                  color:
                    'rgba(255,255,255,.42)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '.1em',
                }}
              >
                PROFILE PHOTO
              </p>

              <h3
                style={{
                  margin: '5px 0 0',
                  color: '#fff',
                  fontSize: 18,
                }}
              >
                プロフィール写真を変更
              </h3>
            </div>

            <button
              type="button"
              onClick={() =>
                galleryInputRef.current?.click()
              }
              style={actionButtonStyle}
            >
              <ImageUp size={19} />
              写真を選択
            </button>

            <button
              type="button"
              onClick={() =>
                cameraInputRef.current?.click()
              }
              style={actionButtonStyle}
            >
              <Camera size={19} />
              写真を撮影
            </button>

            <button
              type="button"
              onClick={() =>
                setShowAvatarMenu(false)
              }
              style={{
                ...actionButtonStyle,
                justifyContent: 'center',
                marginTop: 6,
                color:
                  'rgba(255,255,255,.52)',
              }}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* 1:1 CROPPER */}
      {cropImage && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 110,
            background: '#08090d',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <header
            style={{
              height: 64,
              padding: '0 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent:
                'space-between',
              borderBottom:
                '1px solid rgba(255,255,255,.08)',
            }}
          >
            <button
              type="button"
              onClick={closeCropper}
              disabled={avatarUploading}
              style={roundButtonStyle}
            >
              <X size={20} />
            </button>

            <div
              style={{
                textAlign: 'center',
              }}
            >
              <strong
                style={{
                  display: 'block',
                  color: '#fff',
                  fontSize: 14,
                }}
              >
                写真を調整
              </strong>

              <span
                style={{
                  color:
                    'rgba(255,255,255,.38)',
                  fontSize: 10,
                }}
              >
                1 : 1
              </span>
            </div>

     <button
  type="button"
  onClick={saveAvatar}
  disabled={
    avatarUploading ||
    !croppedAreaPixels
  }
  style={{
    ...roundButtonStyle,
    background:
      'rgba(139,92,246,.92)',
    color: '#fff',
    marginRight: 58,
  }}
>              <Check size={20} />
            </button>
          </header>

          <div
            style={{
              position: 'relative',
              flex: 1,
              minHeight: 0,
            }}
          >
            <Cropper
              image={cropImage}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(
                _,
                pixels,
              ) =>
                setCroppedAreaPixels(
                  pixels,
                )
              }
            />
          </div>

          <div
            style={{
              padding:
                '18px 22px calc(24px + env(safe-area-inset-bottom))',
              background:
                'rgba(12,13,18,.96)',
              borderTop:
                '1px solid rgba(255,255,255,.08)',
            }}
          >
            <p
              style={{
                margin: '0 0 10px',
                color:
                  'rgba(255,255,255,.42)',
                fontSize: 10,
                textAlign: 'center',
              }}
            >
              ピンチまたはスライダーで拡大
            </p>

            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(event) =>
                setZoom(
                  Number(
                    event.target.value,
                  ),
                )
              }
              style={{
                width: '100%',
                accentColor: '#8b5cf6',
              }}
            />

            {avatarUploading && (
              <p
                style={{
                  margin: '12px 0 0',
                  color: '#fff',
                  textAlign: 'center',
                  fontSize: 12,
                }}
              >
                保存中...
              </p>
            )}
          </div>
        </div>
      )}

      {/* NAV */}
      <nav className="outingNav">
        <Link href="/">
          <HomeIcon />
          <span>Home</span>
        </Link>

        <Link href="/guide">
          <BookOpen />
          <span>Guide</span>
        </Link>

        <Link href="/missions">
          <Target />
          <span>Mission</span>
        </Link>

        <Link href="/stream">
          <Images />
          <span>Stream</span>
        </Link>

        <Link
          href="/me"
          className="active"
        >
          <UserRound />
          <span>My</span>
        </Link>
      </nav>
    </main>
  )
}

const actionButtonStyle:
  React.CSSProperties = {
  width: '100%',
  minHeight: 54,
  padding: '0 14px',
  border: 0,
  borderRadius: 16,
  background:
    'rgba(255,255,255,.055)',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginTop: 6,
  fontSize: 14,
  cursor: 'pointer',
}

const roundButtonStyle:
  React.CSSProperties = {
  width: 42,
  height: 42,
  padding: 0,
  border: 0,
  borderRadius: 999,
  background:
    'rgba(255,255,255,.07)',
  color: '#fff',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
}