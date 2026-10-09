'use client';

// Wraps every page. It:
// 1. loads the logged-in person's profile once and shares it with every page (useProfile),
// 2. sends people to the right place (login, first-login password change, pages their role can't use),
// 3. draws the navigation sidebar for their role,
// 4. applies light or dark mode.

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '../lib/supabaseClient';
import { isLeadership, isAuditTeam, isClient, isFirmStaff, teamOf, homeFor } from '../lib/roles';

const ProfileContext = createContext({ profile: null, refreshProfile: async () => {} });

export function useProfile() {
  return useContext(ProfileContext);
}

const PUBLIC_PATHS = ['/login'];
const CLIENT_PATHS = ['/reports', '/account', '/settings', '/change-password'];

export function applyTheme(theme) {
  const dark = theme === 'dark'
    || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('odyssey-theme', theme); } catch (e) { /* private window: ignore */ }
}

// Returns where to send this person instead, or null if they may stay on this page.
function redirectFor(profile, path) {
  if (!profile) return '/login';
  if (profile.must_change_password && path !== '/change-password') return '/change-password';

  if (isClient(profile.role)) {
    return CLIENT_PATHS.some((p) => path.startsWith(p)) ? null : '/reports';
  }
  if (!isFirmStaff(profile.role)) return '/account';

  if (path.startsWith('/admin') && !isLeadership(profile.role)) return '/dashboard';
  // JE testing pages: Audit Team only. Testing history and Analytics: Audit Team and Firm Leadership.
  if (/^\/engagements\/[^/]+\/(upload|criteria|testing)/.test(path) && !isAuditTeam(profile.role)) return '/dashboard';
  if (/^\/engagements\/[^/]+\/(history|analytics)/.test(path) && !isAuditTeam(profile.role) && !isLeadership(profile.role)) return '/dashboard';
  return null;
}

function navItems(role) {
  if (isClient(role)) {
    return [
      { href: '/reports', label: 'My Reports' },
      { href: '/account', label: 'My Account' },
      { href: '/settings', label: 'Settings' },
    ];
  }
  const items = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/engagements', label: 'Engagements' },
    { href: '/reports', label: 'Reports' },
  ];
  if (isLeadership(role)) items.push({ href: '/admin/users', label: 'Manage Users' });
  items.push({ href: '/account', label: 'My Account' }, { href: '/settings', label: 'Settings' });
  return items;
}

export default function AppShell({ children }) {
  const [profile, setProfile] = useState(null);
  const [checked, setChecked] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const isPublic = PUBLIC_PATHS.includes(pathname);

  async function refreshProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setProfile(null);
      setChecked(true);
      return null;
    }
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, must_change_password, is_active, client_engagement_id, theme')
      .eq('id', user.id)
      .single();

    // A deactivated account is signed out straight away.
    if (!data || data.is_active === false) {
      await supabase.auth.signOut();
      setProfile(null);
      setChecked(true);
      return null;
    }
    const full = { ...data, email: data.email || user.email };
    setProfile(full);
    applyTheme(full.theme || 'system');
    setChecked(true);
    return full;
  }

  useEffect(() => {
    refreshProfile();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') refreshProfile();
    });
    return () => subscription.unsubscribe();
  }, []);

  const target = checked && !isPublic ? redirectFor(profile, pathname) : null;

  useEffect(() => {
    if (target) router.replace(target);
    // Already logged in and on the login page: go home.
    if (checked && isPublic && profile) router.replace(profile.must_change_password ? '/change-password' : homeFor(profile.role));
  }, [target, checked, isPublic, profile]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  const value = { profile, refreshProfile };

  if (isPublic) {
    return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
  }
  if (!checked || target) {
    return <p style={{ padding: 24 }}>Loading...</p>;
  }

  const showNav = !profile.must_change_password;

  return (
    <ProfileContext.Provider value={value}>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        {showNav && (
          <nav style={{ width: 210, flexShrink: 0, background: '#1f2933', color: '#f5f7fa', padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontWeight: 'bold', fontSize: 20, padding: '0 8px 4px' }}>ODYSSEY</div>
            <div style={{ fontSize: 12, color: '#9aa5b1', padding: '0 8px 16px' }}>
              {profile.full_name || profile.email}<br />{profile.role} · {teamOf(profile.role)}
            </div>
            {navItems(profile.role).map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{ padding: '8px 10px', borderRadius: 4, textDecoration: 'none', color: '#f5f7fa', background: active ? '#3e4c59' : 'transparent' }}
                >
                  {item.label}
                </Link>
              );
            })}
            <button
              onClick={handleLogout}
              style={{ marginTop: 'auto', padding: '8px 10px', background: 'transparent', color: '#f5f7fa', border: '1px solid #52606d', borderRadius: 4, cursor: 'pointer', textAlign: 'left' }}
            >
              Log out
            </button>
          </nav>
        )}
        <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
      </div>
    </ProfileContext.Provider>
  );
}
