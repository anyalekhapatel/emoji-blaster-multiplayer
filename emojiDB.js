// PLACEHOLDER DATASET — reconstructed from memory of your Construct 3 project.
// Your actual keyword lists live in your Construct export's data.json.
// Upload that file and this can be swapped for your exact, verified dataset.

const EMOJI_DB = {
  "🤣": ["crying", "face", "floor", "funny", "haha", "happy", "hehe", "hilarious", "joy", "laugh", "lmao", "lol", "rofl"],
  "😘": ["adorbs", "bae", "blowing", "face", "flirt", "heart", "ily", "kiss", "love", "lover", "miss", "muah", "romantic"],
  "👏": ["applause", "approval", "awesome", "clap", "congrats", "congratulations", "excited", "great", "nice"],
  "😳": ["amazed", "awkward", "crazy", "dazed", "dead", "disbelief", "embarrassed", "face", "flustered", "shocked"],
  "😎": ["awesome", "beach", "bright", "bro", "chilling", "cool", "face", "rad", "relaxed", "shades", "slay"],
  "👌": ["awesome", "bet", "dope", "fleek", "fosho", "got", "gotcha", "hand", "legit", "ok", "okay", "perfect"],
  "💪": ["arm", "beast", "bench", "biceps", "bodybuilder", "bro", "curls", "flex", "gains", "gym", "jacked", "strong"],
  "😏": ["boss", "dapper", "face", "flirt", "homie", "kidding", "leer", "shade", "slick", "sly", "smirk", "smug"],
  "💯": ["100", "a+", "agree", "clearly", "definitely", "faithful", "fleek", "full", "hundred", "keep", "perfect", "true"],
  "😜": ["crazy", "epic", "eye", "face", "funny", "joke", "loopy", "nutty", "party", "stuck-out", "tongue", "wacky", "weirdo", "wink", "winking", "yolo"],
  "😐": ["awkward", "blank", "deadpan", "expressionless", "face", "fine", "jealous", "meh", "neutral"],
  "😇": ["angel", "angelic", "blessed", "face", "fairy", "fairytale", "fantasy", "halo", "happy", "innocent"],
  "💰": ["bag", "bank", "bet", "billion", "cash", "cost", "dollar", "gold", "million", "money", "moneybag"],
  "😑": ["awkward", "dead", "expressionless", "face", "fine", "inexpressive", "jealous", "meh", "not"],
  "💩": ["bs", "comic", "doo", "dung", "face", "fml", "monster", "pile", "poo", "poop", "smelly", "smh", "stink"],
  "👋": ["bye", "cya", "g2g", "greetings", "gtg", "hand", "hello", "hey", "hi", "later", "outtie", "ttfn", "ttyl", "wave"],
  "🌈": ["gay", "genderqueer", "lesbian", "lgbt", "lgbtq", "lgbtqia", "nature", "pride"],
  "👊": ["absolutely", "agree", "boom", "bro", "bruh", "bump", "clenched", "correct", "fist", "hand", "knuckles"],
  "🥹": ["admiration", "aww", "back", "cry", "embarrassed", "face", "feelings", "grateful", "gratitude"],
  "😙": ["143", "closed", "date", "dating", "eye", "eyes", "face", "flirt", "ily", "kiss", "kisses", "kissing", "love"]
};

const EMOJI_LIST = Object.keys(EMOJI_DB);

// Keywords that apply to both emojis (case-insensitively deduped, values
// taken from `a`'s list). Used by Double Sync mode, where a round shows two
// emojis and the room has to land on a word that fits both.
function sharedKeywords(a, b) {
  const setB = new Set((EMOJI_DB[b] || []).map((k) => k.toLowerCase()));
  return (EMOJI_DB[a] || []).filter((k) => setB.has(k.toLowerCase()));
}

// Precomputed once at module load (20 emojis = 190 pairs, cheap either way):
// every emoji pair that actually shares a keyword, so Double Sync can pick a
// random valid pair directly instead of retrying random picks and hoping.
const SHARED_PAIRS = [];
for (let i = 0; i < EMOJI_LIST.length; i++) {
  for (let j = i + 1; j < EMOJI_LIST.length; j++) {
    const a = EMOJI_LIST[i];
    const b = EMOJI_LIST[j];
    const shared = sharedKeywords(a, b);
    if (shared.length > 0) SHARED_PAIRS.push({ a, b, shared });
  }
}

module.exports = { EMOJI_DB, EMOJI_LIST, sharedKeywords, SHARED_PAIRS };
