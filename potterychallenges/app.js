// Pottery Challenges: app shell. Sign in with Google, check the allowlist, show the tabs.
// Same Firebase project and sign-in approach as /wishlist. Access is controlled by the
// Firestore rules and the allowlist collection, not by anything in this file.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut }
  from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, doc, getDoc }
  from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

// Public web config (same project as the wishlist). The rules protect the data, not this.
const app = initializeApp({
  apiKey: 'AIzaSyDeNGxzrhLGDPRR89GU9Pj1ManveICBRvE',
  authDomain: 'wishlist-7a0d5.firebaseapp.com',
  projectId: 'wishlist-7a0d5',
  storageBucket: 'wishlist-7a0d5.firebasestorage.app',
  messagingSenderId: '503206940547',
  appId: '1:503206940547:web:9e20ebff5335315f0cf0b6',
});
const auth = getAuth(app);
const db = getFirestore(app);

// Bump with every change, and say what's new in a few words.
const VERSION = { number: '0.1', date: 'Nov 22', whatsNew: 'Sign-in and the app frame.' };

const $ = (id) => document.getElementById(id);
const views = ['loading', 'signedOut', 'denied', 'app'];
let currentView = 'loading';
function show(view) {
  if (view !== currentView) snaplog(`view ${currentView} → ${view}`);
  currentView = view;
  for (const v of views) $(v).hidden = v !== view;
  document.getElementById('whatsNew').hidden = view !== 'app' || !whatsNewDue;
}

function store(key, value) {
  try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (e) { return null; }
}

// ---------- #debug: a short on-screen log, handy on a phone ----------
const SNAPLOG = 'potterychallenges.log';
function snaplog(msg) {
  try {
    const a = JSON.parse(sessionStorage.getItem(SNAPLOG) || '[]');
    a.push(new Date().toTimeString().slice(0, 8) + ' ' + msg);
    sessionStorage.setItem(SNAPLOG, JSON.stringify(a.slice(-80)));
  } catch (e) {}
  if (location.hash === '#debug') showSnaplog();
}
function showSnaplog() {
  let box = document.getElementById('snaplog');
  if (!box) {
    box = document.createElement('pre');
    box.id = 'snaplog';
    box.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:99;max-height:40vh;overflow:auto;margin:0;padding:8px;'
      + 'font:11px/1.35 ui-monospace,Menlo,monospace;background:rgba(0,0,0,.85);color:#9f9;border-radius:8px;white-space:pre-wrap;';
    document.body.append(box);
  }
  try { box.textContent = JSON.parse(sessionStorage.getItem(SNAPLOG) || '[]').join('\n'); } catch (e) {}
}
addEventListener('error', (e) => snaplog('error: ' + e.message));
addEventListener('unhandledrejection', (e) => snaplog('rejection: ' + (e.reason && (e.reason.code || e.reason.message))));
addEventListener('hashchange', () => { if (location.hash === '#debug') showSnaplog(); else document.getElementById('snaplog')?.remove(); });
snaplog('page load');

// iPhones don't shrink the page when the keyboard opens; track its height so popups can lift.
if (window.visualViewport) {
  const vv = window.visualViewport;
  const lift = () => {
    const kb = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--kb', kb + 'px');
  };
  vv.addEventListener('resize', lift);
  vv.addEventListener('scroll', lift);
  lift();
}

// ---------- version + what's new ----------
let whatsNewDue = false;
$('siteFoot').textContent = `Pottery Challenges · v${VERSION.number} · updated ${VERSION.date}`;
(function whatsNew() {
  const seen = store('potterychallenges.version');
  const remember = () => store('potterychallenges.version', VERSION.number);
  if (!seen) return remember();          // first visit: nothing to announce
  if (seen === VERSION.number) return;
  whatsNewDue = true;
  $('whatsNewTitle').textContent = `Updated to v${VERSION.number}:`;
  $('whatsNewText').textContent = VERSION.whatsNew;
  $('whatsNewOk').addEventListener('click', () => { whatsNewDue = false; $('whatsNew').hidden = true; remember(); });
})();

// ---------- tabs ----------
const TABS = ['draw', 'next', 'library', 'me'];
function currentTab() {
  const fromHash = location.hash.replace(/^#\/?/, '');
  if (TABS.includes(fromHash)) return fromHash;
  const saved = store('potterychallenges.tab');
  return TABS.includes(saved) ? saved : 'draw';
}
function showTab() {
  const tab = currentTab();
  store('potterychallenges.tab', tab);
  for (const el of document.querySelectorAll('.tab')) el.hidden = el.dataset.tab !== tab;
  for (const b of document.querySelectorAll('.tabs button')) {
    if (b.dataset.go === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  scrollTo(0, 0);
}
for (const b of document.querySelectorAll('.tabs button')) {
  b.addEventListener('click', () => { location.hash = '#/' + b.dataset.go; });
}
addEventListener('hashchange', () => { if (currentView === 'app') showTab(); });

// ---------- auth ----------
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

$('signIn').addEventListener('click', async () => {
  $('signInErr').textContent = '';
  const t0 = Date.now();
  const secs = () => Math.round((Date.now() - t0) / 1000);
  try {
    await signInWithPopup(auth, provider);
    snaplog(`sign-in ok after ${secs()}s`);
  } catch (e) {
    snaplog(`sign-in failed after ${secs()}s: ${e.code || e.message}`);
    // No redirect fallback on purpose: redirect sign-in breaks on phones because the sign-in
    // helper lives on a different domain (firebaseapp.com) than this page.
    if (e.code === 'auth/cancelled-popup-request') return;
    if (e.code === 'auth/popup-closed-by-user') {
      // A quick close is someone changing their mind. A slow one usually means the browser
      // stopped the Google window from handing the sign-in back to this page.
      if (secs() < 8) return;
      $('signInErr').textContent = 'The Google window closed before sign-in finished. If you did finish signing in, your browser is likely blocking it: try Chrome, then try again.';
      return;
    }
    const blocked = e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-environment';
    $('signInErr').textContent = blocked
      ? 'Your browser blocked the Google sign-in window. Allow pop-ups for this site, or open this page in Chrome, then try again.'
      : e.code === 'auth/unauthorized-domain'
      ? `Sign-in isn't switched on for ${location.hostname} yet. Add it in Firebase under Authentication → Settings → Authorized domains.`
      : `Sign-in didn't work (${e.code || e.message}). Try again?`;
  }
});

let signingOut = false;
let signOutGrace = null;
function doSignOut() { signingOut = true; signOut(auth); }
$('signOut').addEventListener('click', doSignOut);
$('deniedSignOut').addEventListener('click', doSignOut);

let me = null;         // { uid, email, name, role } once allowed in
let sessionUid = null; // who we last handled, allowed or not

onAuthStateChanged(auth, (user) => {
  snaplog(`auth: ${user ? 'signed in' : 'signed out'}${signingOut ? ' (sign-out tapped)' : ''}`);
  // Firebase can re-announce the same signed-in user (token refresh, tab waking up).
  // Re-checking would flash the loading view, so ignore repeats.
  if (user && sessionUid && user.uid === sessionUid) {
    if (signOutGrace) { clearTimeout(signOutGrace); signOutGrace = null; snaplog('auth blip ignored'); }
    return;
  }
  // It can also briefly report "signed out" and then "signed in" again. Unless someone tapped
  // Sign out, wait a moment before believing it.
  if (!user && sessionUid && !signingOut) {
    if (!signOutGrace) signOutGrace = setTimeout(() => { signOutGrace = null; applyAuth(null); }, 3000);
    return;
  }
  clearTimeout(signOutGrace); signOutGrace = null;
  signingOut = false;
  applyAuth(user);
});

async function applyAuth(user) {
  sessionUid = user ? user.uid : null;
  if (!user) {
    me = null;
    return show('signedOut');
  }
  const email = (user.email || '').toLowerCase();
  show('loading');
  // The allowlist entry decides who is in. The rules let each person read only their own entry.
  let entry = null;
  try {
    const snap = await getDoc(doc(db, 'allowlist', email));
    entry = snap.exists() ? snap.data() : null;
  } catch (e) {
    snaplog(`allowlist read failed: ${e.code || e.message}`);
  }
  if (!entry) {
    me = null;
    $('deniedEmail').textContent = email;
    return show('denied');
  }
  me = { uid: user.uid, email, name: (user.displayName || email).split(' ')[0], role: entry.role === 'admin' ? 'admin' : 'member' };
  $('whoName').textContent = me.name;
  $('meEmail').textContent = me.email;
  $('meRole').textContent = me.role === 'admin' ? 'Admin' : 'Member';
  show('app');
  showTab();
}
