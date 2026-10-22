import { useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';

export default function UserAvatar({ profile, className = '' }) {
  const { locale } = useTranslation();
  const [failedSource, setFailedSource] = useState(null);
  const initials = [profile?.firstName?.[0], profile?.lastName?.[0]].filter(Boolean).join('').toLocaleUpperCase(locale) || 'GT';
  return <span className={`user-avatar ${className}`} aria-hidden="true">
    {profile?.avatar && profile.avatar !== failedSource
      ? <img src={profile.avatar} alt="" onError={() => setFailedSource(profile.avatar)} />
      : initials}
  </span>;
}
