import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { CSSProperties } from 'react';
import { dicebearAvatar } from '../dicebear';
import {
  getAvatarAttempt,
  getAvatarOverride,
  isAvatarBroken,
  markAvatarBroken,
  useAvatarRevision,
} from '../avatarCache';

type UserAvatarProps = {
  username: string;
  // Immutable user id; the photo key. Without one (bots, hotseat seats) there is no photo.
  userId?: string;
  size: number;
  fallbackStyle?: CSSProperties;
  avatarStyle?: string | null;
  style?: CSSProperties;
  // Whether a photo exists. Unknown counts as "no photo", so nothing is requested.
  hasAvatarPhoto?: boolean;
  // Bots and other non-account seats have no photo: never request one for them.
  isBot?: boolean;
  // Called when a photo was expected but failed to load (404 on a posted
  //  avatar, or bytes the browser cannot decode). The DiceBear fallback always
  //  still happens; this only lets a parent announce the failure.
  onPhotoError?: () => void;
};

export function UserAvatar({
  username,
  userId,
  size,
  fallbackStyle,
  avatarStyle,
  style,
  hasAvatarPhoto,
  isBot,
  onPhotoError,
}: UserAvatarProps) {
  // Subscribe to avatar-state changes; the values themselves are read below.
  useAvatarRevision();
  const imgRef = useRef<HTMLImageElement | null>(null);
  const { t } = useTranslation();

  if (!username) {
    return (
      <div
        style={{
          ...fallbackStyle,
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...style,
          flex: 'none',
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={size * 0.55}
          height={size * 0.55}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: fallbackStyle?.color ?? '#a99a83', opacity: 0.8 }}
        >
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
    );
  }

  // A live update (SSE avatar_changed, or our own upload) is newer than the
  // payload, so it wins when present. `isBot` is a hard stop: a bot has no
  // account and is never asked for a photo regardless of the flags.
  const override = getAvatarOverride(userId);
  const hasPhoto = override ? override.has : hasAvatarPhoto === true;
  const usePhoto = !!userId && !isBot && hasPhoto && !isAvatarBroken(userId);
  const fallbackSrc = dicebearAvatar(username, override?.style ?? avatarStyle);
  // The `?v=` stamp forces a real fetch: an unchanged URL can come from the
  // browser's in-memory image cache with no request, so `no-cache` never
  // revalidates.
  const src = usePhoto
    ? `/api/user/id/${userId}/avatar${override?.v ? `?v=${override.v}` : ''}`
    : fallbackSrc;

  return (
    <img
      key={getAvatarAttempt(userId)}
      ref={imgRef}
      src={src}
      onError={() => {
        // Nothing to show: no photo (404), or bytes the browser cannot decode.
        // Record the verdict so we stop asking for this user, and fall back to
        // the generated avatar.
        if (userId) markAvatarBroken(userId);
        // Only announce if a photo was actually expected (not the normal
        // "no photo" case), so parents can surface a real load failure.
        if (usePhoto) onPhotoError?.();
        if (imgRef.current) imgRef.current.src = fallbackSrc;
      }}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        objectFit: 'cover',
        display: 'block',
        flex: 'none',
        ...style,
      }}
      alt={t('common.avatarAlt', { username })}
    />
  );
}
