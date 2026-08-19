// i18n runtime for Emoji Blaster.
//
// English-only for now -- there's no language switcher in this game yet.
// I18N_STRINGS.en is the single source of truth for every piece of UI text;
// more languages get added as new blocks here (I18N_STRINGS.es, etc.) once
// translations come back. The clean key -> English export handed off for
// translation lives at ../i18n-source/en.json (repo root, outside public/,
// so it's never part of what actually gets deployed) -- keep that file's
// keys in sync with this one. Mirrors emoji-survey-scramble's and
// emoji-munchers' identical i18n.js -- same shape everywhere on purpose, so
// a translator (or future dev) never has to re-learn the pattern per repo.
//
// t(key, vars) looks up a string and fills in any {placeholder} tokens
// (e.g. t('lobby_status_waiting_min', { min: 2 })). Falls back to the raw
// key if it's ever missing, so a typo shows up as visibly broken text
// instead of silently rendering nothing.
//
// Resolved per-call (not a fixed top-level const) so it reflects whatever
// interface language the QMoji 2.0 homescreen actually launched this game
// with (?uiLang=), read directly from the URL rather than waiting on
// arcade-client.js's async initArcade() -- checking the URL synchronously
// here means the very first render already picks the right language.
function resolveI18nLang() {
  try {
    const fromUrl = new URLSearchParams(location.search).get('uiLang');
    if (fromUrl && I18N_STRINGS[fromUrl]) return fromUrl;
    const fromStorage = localStorage.getItem('qmoji.uiLang');
    if (fromStorage && I18N_STRINGS[fromStorage]) return fromStorage;
  } catch (e) {
    /* localStorage/URL access can throw in some embedded contexts -- fall through to "en" */
  }
  return 'en';
}

const I18N_STRINGS = {
  en: {
    app_title: "Emoji Blaster",
    app_tagline: "Type the keyword. Sync with your team. Beat the clock.",
    back_to_launchpad: "RETURN TO LAUNCH PAD",
    loading: "LOADING",
    username_placeholder: "Your name",
    mode_hint: "Mode (used when you create a room)",
    mode_sync_title: "Sync",
    mode_sync_desc: "One emoji — match its keyword",
    mode_double_title: "Double Sync",
    mode_double_desc: "Two emojis — find the keyword they share",
    create_room_button: "Create Room",
    divider_or: "or",
    join_code_placeholder: "ROOM CODE",
    join_room_button: "Join",
    name_required_error: "Enter a name first.",
    room_code_required_error: "Enter a room code.",
    lobby_title: "Room",
    lobby_share_hint: "Share this code so others can join",
    consensus_level1_title: "Level 1",
    consensus_level1_desc: "2 players match",
    consensus_level2_title: "Level 2",
    consensus_level2_desc: "3 players match",
    consensus_level3_title: "Level 3",
    consensus_level3_desc: "4 players match",
    consensus_locked_hint: "Needs {required} players in the room to pick this level",
    consensus_label_level1: "Level 1 — Two-Player Match",
    consensus_label_level2: "Level 2 — Three-Player Match",
    consensus_label_level3: "Level 3 — Four-Player Match",
    consensus_desc_level1: "An emoji clears once at least 2 players enter the same keyword. The room can hold more than 2 — only 2 need to match.",
    consensus_desc_level2: "An emoji clears once at least 3 players independently enter the same keyword. The room can hold more than 3 — only 3 need to match.",
    consensus_desc_level3: "An emoji clears once at least 4 players enter the same keyword. The room can hold more than 4 — only 4 need to match.",
    mode_label_sync: "Sync",
    mode_label_double: "Double Sync",
    ready_badge: "Ready",
    not_ready_badge: "Not ready",
    ready_up_button: "Ready Up",
    cancel_ready_button: "Cancel Ready",
    start_now_button: "Start Now",
    lobby_auto_start_hint: "Starts automatically once everyone's ready — or hit Start Now once enough players are in.",
    lobby_status_in_progress: "A game is in progress — you'll be able to ready up once it ends.",
    lobby_status_waiting_min: "Waiting for at least {min} players to join…",
    scoreboard_heading: "Scoreboard",
    scoreboard_hint: "(shared team score — beat the clock!)",
    guess_placeholder: "Type the keyword and press Enter…",
    emoji_correct: '{username} got it! ("{guess}")',
    emoji_miss: "Missed it — next one incoming…",
    sync_progress: "Closest match: {bestCount}/{required} players — keep typing words until enough match!",
    game_over_summary: "Time's up! Your team synced {teamScore} emoji together.",
    gameover_title: "Game Over",
    final_score_heading: "Final Score",
    play_again_button: "Play Again",
  },
};

function t(key, vars) {
  const table = I18N_STRINGS[resolveI18nLang()] || I18N_STRINGS.en;
  let text = (table && table[key]) || I18N_STRINGS.en[key] || key;
  if (vars) {
    Object.keys(vars).forEach((k) => {
      text = text.split(`{${k}}`).join(vars[k]);
    });
  }
  return text;
}

// Applies every static (non-templated) string in one pass on load --
// anything with dynamic content (a room code, a countdown, a player name)
// is set directly by client.js via t() instead, since data-i18n has no way
// to carry variables.
function applyStaticTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
}
