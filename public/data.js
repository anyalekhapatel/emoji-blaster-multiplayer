// data.js
// Single source of truth for the emoji -> keyword dataset.
// Used by the solo webapp (game.js) and can be imported by the
// multiplayer server too, so both stay in sync with the real data.

const EMOJI_DATA = [
  { emoji: "🤣", keywords: ["crying","face","floor","funny","haha","happy","hehe","hilarious","joy","laugh","lmao","lol","rofl","roflmao","rolling","tear"] },
  { emoji: "😘", keywords: ["adorbs","bae","blowing","face","flirt","heart","ily","kiss","love","lover","miss","muah","romantic","smooch","xoxo","you"] },
  { emoji: "👏", keywords: ["applause","approval","awesome","clap","congrats","congratulations","excited","good","great","hand","homie","job","nice","prayed","well","yay"] },
  { emoji: "😳", keywords: ["amazed","awkward","crazy","dazed","dead","disbelief","embarrassed","face","flushed","geez","heat","hot","impressed","jeez","what","wow"] },
  { emoji: "😎", keywords: ["awesome","beach","bright","bro","chilling","cool","face","rad","relaxed","shades","slay","smile","style","sunglasses","swag","win"] },
  { emoji: "👌", keywords: ["awesome","bet","dope","fleek","fosho","got","gotcha","hand","legit","OK","okay","pinch","rad","sure","sweet","three"] },
  { emoji: "💪", keywords: ["arm","beast","bench","biceps","bodybuilder","bro","curls","flex","gains","gym","jacked","muscle","press","ripped","strong","weightlift"] },
  { emoji: "😏", keywords: ["boss","dapper","face","flirt","homie","kidding","leer","shade","slick","sly","smirk","smug","snicker","suave","suspicious","swag"] },
  { emoji: "💯", keywords: ["100","a+","agree","clearly","definitely","faithful","fleek","full","hundred","keep","perfect","point","score","TRUE","truth","yup"] },
  { emoji: "😜", keywords: ["crazy","epic","eye","face","funny","joke","loopy","nutty","party","stuck-out","tongue","wacky","weirdo","wink","winking","yolo"] },
  { emoji: "😐", keywords: ["awkward","blank","deadpan","expressionless","face","fine","jealous","meh","neutral","oh","shade","straight","unamused","unhappy","unimpressed","whatever"] },
  { emoji: "😇", keywords: ["angel","angelic","angels","blessed","face","fairy","fairytale","fantasy","halo","happy","innocent","peaceful","smile","smiling","spirit","tale"] },
  { emoji: "💰", keywords: ["bag","bank","bet","billion","cash","cost","dollar","gold","million","money","moneybag","paid","paying","pot","rich","win"] },
  { emoji: "😑", keywords: ["awkward","dead","expressionless","face","fine","inexpressive","jealous","meh","not","oh","omg","straight","uh","unhappy","unimpressed","whatever"] },
  { emoji: "💩", keywords: ["bs","comic","doo","dung","face","fml","monster","pile","poo","poop","smelly","smh","stink","stinks","stinky","turd"] },
  { emoji: "👋", keywords: ["bye","cya","g2g","greetings","gtg","hand","hello","hey","hi","later","outtie","ttfn","ttyl","wave","yo","you"] },
  { emoji: "🌈", keywords: ["gay","genderqueer","glbt","glbtq","lesbian","lgbt","lgbtq","lgbtqia","nature","pride","queer","rain","rainbow","trans","transgender","weather"] },
  { emoji: "👊", keywords: ["absolutely","agree","boom","bro","bruh","bump","clenched","correct","fist","hand","knuckle","oncoming","pound","punch","rock","ttyl"] },
  { emoji: "🥹", keywords: ["admiration","aww","back","cry","embarrassed","face","feelings","grateful","gratitude","holding","joy","please","proud","resist","sad","tears"] },
  { emoji: "😙", keywords: ["143","closed","date","dating","eye","eyes","face","flirt","ily","kiss","kisses","kissing","love","night","smile","smiling"] },
];

// Returns the shared keywords between two emoji entries (used by Level 3).
function sharedKeywords(entryA, entryB) {
  const setB = new Set(entryB.keywords);
  return entryA.keywords.filter(k => setB.has(k));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { EMOJI_DATA, sharedKeywords };
}
