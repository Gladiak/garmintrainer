import { useEffect, useId, useRef, useState } from 'react';
import { ChevronUp, LogOut, Settings2, UserRound } from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';
import UserAvatar from './UserAvatar';

export default function SidebarAccountMenu({ profile, name, subtitle, sidebarOpen, onProfile, onSettings, onLogout }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const container = useRef(null);
  const trigger = useRef(null);
  const menu = useRef(null);
  const initialItem = useRef(0);
  const id = useId();

  useEffect(() => { setOpen(false); }, [sidebarOpen]);

  useEffect(() => {
    if (!open) return;
    const items = menu.current.querySelectorAll('[role="menuitem"]');
    items[initialItem.current]?.focus();

    function closeOutside(event) {
      if (!container.current.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      trigger.current.focus();
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  function openAt(index) {
    initialItem.current = index;
    if (open) menu.current.querySelectorAll('[role="menuitem"]')[index]?.focus();
    else setOpen(true);
  }

  function handleMenuKey(event) {
    if (event.key === 'Tab') { trigger.current.focus(); setOpen(false); return; }
    const items = Array.from(menu.current.querySelectorAll('[role="menuitem"]'));
    const index = items.indexOf(document.activeElement);
    const next = { ArrowDown: (index + 1) % items.length, ArrowUp: (index + items.length - 1) % items.length, Home: 0, End: items.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    items[next].focus();
  }

  function select(action) {
    setOpen(false);
    trigger.current.focus();
    action();
  }

  return <div className="sidebar-account" ref={container}>
    {open && <div className="sidebar-account-menu" id={`${id}-menu`} role="menu" aria-labelledby={`${id}-trigger`} ref={menu} onKeyDown={handleMenuKey}>
      <button type="button" role="menuitem" tabIndex={-1} onClick={() => select(onProfile)}><UserRound size={18} aria-hidden="true" />{t('nav.profile')}</button>
      <button type="button" role="menuitem" tabIndex={-1} onClick={() => select(onSettings)}><Settings2 size={18} aria-hidden="true" />{t('nav.settings')}</button>
      <div className="sidebar-account-menu-divider" role="separator" />
      <button type="button" role="menuitem" tabIndex={-1} onClick={() => select(onLogout)}><LogOut size={18} aria-hidden="true" />{t('auth.logout')}</button>
    </div>}
    <button type="button" className="sidebar-profile" id={`${id}-trigger`} ref={trigger} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined}
      onClick={() => { initialItem.current = 0; setOpen(!open); }}
      onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openAt(event.key === 'ArrowUp' ? 2 : 0); } }}>
      <UserAvatar profile={profile} className="avatar" />
      <div><strong>{name}</strong><span>{subtitle}</span></div>
      <ChevronUp size={17} aria-hidden="true" className={open ? 'account-chevron is-open' : 'account-chevron'} />
    </button>
  </div>;
}
