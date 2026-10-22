import { useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import Modal from './Modal';
import ProfileForm from './ProfileForm';
export { PRIMARY_SPORT_LABELS, profileName } from './ProfileForm';

export default function ProfileModal({ profile, garminStatusKey, required = false, onClose, onSave }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return <Modal className="profile-modal" title={t(required ? 'auth.setupTitle' : 'profile.editTitle')}
    subtitle={t(required ? 'auth.setupSubtitle' : 'profile.formSubtitle')}
    dismissible={!required && !busy} onClose={busy ? () => {} : onClose}>
    <ProfileForm profile={profile} garminStatusKey={garminStatusKey} activeProfileId={profile.id} required={required} onBack={onClose} onSave={onSave} onBusyChange={setBusy} />
  </Modal>;
}
