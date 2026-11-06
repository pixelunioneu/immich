/*
 * PixelUnion CSAT pop-up (downstream addition, see changes.md).
 *
 * Shows a Formbricks link survey in an iframe card. No dependencies, no cookies,
 * no user identifiers. Asks on the 3rd visit, after 15s of visible time. Once the
 * survey is completed: not again for 90 days. If it was closed or ignored: asked
 * again after 21 days, up to 3 times, then every 90 days.
 *
 * nginx caches .js for a year: when this file changes, ship it as csat.v2.js
 * (and update the <script> tag in app.html) instead of editing it in place.
 *
 * Override defaults before this script loads via `window.PU_CSAT = { ... }`.
 */
(function () {
  'use strict';

  var cfg = Object.assign(
    {
      surveyUrl: 'https://app.formbricks.com/s/cmv85sto08pof01uifslyipfq?embed=true',
      minVisits: 3,
      delaySeconds: 15,
      cooldownDays: 90, // after the survey was completed, or after `maxAttempts` unanswered asks
      dismissCooldownDays: 21, // after an unanswered ask (closed, ignored): ask again this much later
      maxAttempts: 3, // unanswered asks before falling back to `cooldownDays`
      sampleRate: 1, // 1 = everyone, 0.1 = 10% of browsers
      // Card size in px. The embed does not report its height, so this is fixed: raise
      // `height` if a later question (e.g. the comment box) starts to scroll.
      width: 360,
      height: 360,
      closeAfterCompleteMs: 4000, // leave the thank-you screen visible this long, then close
      // Pages that are public or not part of the signed-in experience: never count or ask there.
      skipPaths: /^\/(share|s|auth|maintenance|link)(\/|$)/,
      storageKey: 'pu-csat',
      sessionKey: 'pu-csat-session',
    },
    window.PU_CSAT || {},
  );

  var DAY_MS = 24 * 60 * 60 * 1000;

  function load() {
    try {
      return JSON.parse(localStorage.getItem(cfg.storageKey)) || {};
    } catch (e) {
      return {};
    }
  }

  function save(state) {
    try {
      localStorage.setItem(cfg.storageKey, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;
    }
  }

  function inSession() {
    try {
      return sessionStorage.getItem(cfg.sessionKey) === '1';
    } catch (e) {
      return true; // storage blocked: behave as if already counted, so we never ask
    }
  }

  function markSession() {
    try {
      sessionStorage.setItem(cfg.sessionKey, '1');
    } catch (e) {
      /* ignore */
    }
  }

  // Immich sets this readable cookie while a user is signed in.
  function signedIn() {
    return /(?:^|;\s*)immich_is_authenticated=true/.test(document.cookie);
  }

  function onCooldown(state) {
    if (!state.lastShown) return false;
    var long = state.completed || (state.attempts || 0) >= cfg.maxAttempts;
    var days = long ? cfg.cooldownDays : cfg.dismissCooldownDays;
    return Date.now() - state.lastShown < days * DAY_MS;
  }

  function markCompleted() {
    var state = load();
    state.completed = true;
    save(state);
  }

  function show() {
    var dark = document.documentElement.classList.contains('dark');
    var small = window.matchMedia('(max-width: 640px)').matches;

    var card = document.createElement('div');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Feedback survey');
    card.style.cssText = [
      'position:fixed',
      'z-index:2147483000',
      small ? 'left:12px;right:12px;bottom:12px' : 'right:20px;bottom:84px;width:' + cfg.width + 'px',
      'height:min(' + cfg.height + 'px,80vh)',
      'overflow:hidden',
      'border-radius:14px',
      'border:1px solid ' + (dark ? '#2a313d' : '#e5e7eb'),
      'background:' + (dark ? '#1b2029' : '#fff'),
      'box-shadow:0 12px 40px rgba(0,0,0,.35)',
    ].join(';');

    var frame = document.createElement('iframe');
    frame.src = cfg.surveyUrl;
    frame.title = 'Feedback survey';
    frame.setAttribute('referrerpolicy', 'no-referrer'); // do not leak the environment's address
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block';

    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close survey');
    close.style.cssText =
      'position:absolute;top:6px;right:8px;z-index:1;width:28px;height:28px;border:0;border-radius:14px;' +
      'cursor:pointer;font:20px/26px system-ui,sans-serif;color:#374151;background:rgba(255,255,255,.85)';

    function dismiss() {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('message', onMessage);
      card.remove();
    }
    function onKey(event) {
      if (event.key === 'Escape') dismiss();
    }
    // The embed posts the bare string "formbricksSurveyCompleted" when the survey is finished.
    function onMessage(event) {
      if (event.source !== frame.contentWindow || event.data !== 'formbricksSurveyCompleted') return;
      markCompleted();
      setTimeout(dismiss, cfg.closeAfterCompleteMs);
    }
    close.addEventListener('click', dismiss);
    document.addEventListener('keydown', onKey);
    window.addEventListener('message', onMessage);

    card.appendChild(frame);
    card.appendChild(close);
    document.body.appendChild(card);
  }

  function start() {
    // Without working storage we cannot rate-limit, so never ask.
    if (!save(load())) return;

    var elapsed = 0;
    var counted = false;

    var timer = setInterval(function () {
      if (document.visibilityState !== 'visible') return;
      if (!signedIn() || cfg.skipPaths.test(location.pathname)) return;

      var state = load();

      if (!counted) {
        counted = true;
        if (typeof state.sampled !== 'boolean') state.sampled = Math.random() < cfg.sampleRate;
        if (!inSession()) {
          markSession();
          state.visits = (state.visits || 0) + 1;
        }
        save(state);
      }

      if (!state.sampled || onCooldown(state) || (state.visits || 0) < cfg.minVisits) {
        clearInterval(timer);
        return;
      }

      elapsed += 1;
      if (elapsed >= cfg.delaySeconds) {
        clearInterval(timer);
        state.lastShown = Date.now();
        state.completed = false; // a new ask starts unanswered
        state.attempts = (state.attempts || 0) + 1;
        if (save(state)) show();
      }
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
