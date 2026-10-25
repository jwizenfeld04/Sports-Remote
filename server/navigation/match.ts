// Matching names in OCR text. Shared by the navigators (server/youtubeTv.ts re-exports hasName).
//
// OCR misreads a letter now and then, so longer words are matched with a small edit distance. Two guards stop that
// tolerance from matching the wrong team:
//  - a word that is itself another team's nickname word must match exactly ("Wings" is not "Kings", "Bulls" is
//    not "Bills", "Ducks" is not "Bucks");
//  - nicknames shared across leagues ("Giants", "Cardinals", "Panthers", "Jets", "Rangers", "Kings") are checked
//    against the city when the screen names one: "San Francisco Giants" is not the New York Giants.

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// Every NFL, NBA, MLB and NHL nickname.
const NICKNAMES = [
  // NFL
  "Cardinals", "Falcons", "Ravens", "Bills", "Panthers", "Bears", "Bengals", "Browns", "Cowboys", "Broncos", "Lions", "Packers",
  "Texans", "Colts", "Jaguars", "Chiefs", "Raiders", "Chargers", "Rams", "Dolphins", "Vikings", "Patriots", "Saints", "Giants",
  "Jets", "Eagles", "Steelers", "49ers", "Seahawks", "Buccaneers", "Titans", "Commanders",
  // NBA
  "Hawks", "Celtics", "Nets", "Hornets", "Bulls", "Cavaliers", "Mavericks", "Nuggets", "Pistons", "Warriors", "Rockets", "Pacers",
  "Clippers", "Lakers", "Grizzlies", "Heat", "Bucks", "Timberwolves", "Pelicans", "Knicks", "Thunder", "Magic", "76ers", "Suns",
  "Trail Blazers", "Kings", "Spurs", "Raptors", "Jazz", "Wizards",
  // MLB
  "Diamondbacks", "Braves", "Orioles", "Red Sox", "Cubs", "White Sox", "Reds", "Guardians", "Rockies", "Tigers", "Astros", "Royals",
  "Angels", "Dodgers", "Marlins", "Brewers", "Twins", "Mets", "Yankees", "Athletics", "Phillies", "Pirates", "Padres", "Mariners",
  "Rays", "Rangers", "Blue Jays", "Nationals",
  // NHL
  "Ducks", "Bruins", "Sabres", "Flames", "Hurricanes", "Blackhawks", "Avalanche", "Blue Jackets", "Stars", "Red Wings", "Oilers",
  "Wild", "Canadiens", "Predators", "Devils", "Islanders", "Senators", "Flyers", "Penguins", "Sharks", "Kraken", "Blues", "Lightning",
  "Maple Leafs", "Mammoth", "Canucks", "Golden Knights", "Capitals",
];
const TEAM_WORDS = new Set(NICKNAMES.flatMap((n) => norm(n).split(" ")));

/** Nicknames used by more than one team, with each team's city. */
export const SHARED_NICKNAMES: Record<string, string[]> = {
  giants: ["New York", "San Francisco"],
  cardinals: ["Arizona", "St. Louis"],
  panthers: ["Carolina", "Florida"],
  jets: ["New York", "Winnipeg"],
  rangers: ["Texas", "New York"],
  kings: ["Sacramento", "Los Angeles"],
};

const tolFor = (w: string) => (w.length >= 10 ? 2 : w.length >= 5 ? 1 : 0);

/** One OCR token stands for word `w`: exact, or a misread within tolerance that isn't some other team's word. */
function tokenIs(t: string, w: string): boolean {
  if (t === w) return true;
  if (TEAM_WORDS.has(t)) return false; // another team's word, read correctly
  const tol = tolFor(w);
  if (tol === 0) return false;
  // "rn" and "m" are the same misread either way ("Garnes", "Upcorning"): one letter, not two.
  const rm = (s: string) => s.replace(/rn/g, "m");
  return editDistance(t, w, tol) <= tol || editDistance(rm(t), rm(w), tol) <= tol;
}

/** A name ("Bears", "Red Sox", a program title) appears in the text: every word, anywhere, tolerating a misread letter. */
export function hasName(text: string, name: string): boolean {
  const tokens = norm(text).split(" ");
  return norm(name).split(" ").every((w) => tokens.some((t) => tokenIs(t, w)));
}

/** The words of `phrase` appear consecutively in the text. */
export function hasPhrase(text: string, phrase: string): boolean {
  const tokens = norm(text).split(" ");
  const words = norm(phrase).split(" ");
  for (let i = 0; i + words.length <= tokens.length; i++) if (words.every((w, j) => tokenIs(tokens[i + j], w))) return true;
  return false;
}

export interface TeamName {
  name: string;
  city?: string;
}

/** Where a (possibly multi-word) name starts in the token list. */
function positions(tokens: string[], name: string): number[] {
  const words = norm(name).split(" ");
  const out: number[] = [];
  for (let i = 0; i + words.length <= tokens.length; i++) if (words.every((w, j) => tokenIs(tokens[i + j], w))) out.push(i);
  return out;
}

/** Loose: a city word read with up to two misread letters (one for short words), or OCR look-alikes. */
const looseWord = (t: string, w: string) =>
  t === w || confusable(t) === confusable(w) || (w.length >= 4 && editDistance(t, w, w.length >= 8 ? 2 : 1) <= (w.length >= 8 ? 2 : 1));

/**
 * The text names this team. A nickname shared across leagues is judged by the (up to two) words in front of each
 * place it appears: if they look more like another team's city than this team's, that place is the other team.
 * Matching city words loosely means a misread city ("Son Francisco") still counts against.
 */
export function namesTeam(text: string, team: TeamName): boolean {
  if (!hasName(text, team.name)) return false;
  const cities = SHARED_NICKNAMES[norm(team.name)];
  if (!team.city || !cities) return true;
  const tokens = norm(text).split(" ");
  const score = (city: string, at: number) => {
    const before = tokens.slice(Math.max(0, at - 2), at);
    return norm(city).split(" ").filter((w) => before.some((t) => looseWord(t, w))).length;
  };
  const mine = norm(team.city);
  return positions(tokens, team.name).some((at) => {
    const own = score(mine, at);
    return !cities.some((c) => norm(c) !== mine && score(c, at) > own);
  });
}

/**
 * "<Away> at <Home>" reads the right way round. Teams meet twice a season (division rivals), and both games can be
 * in the same "Upcoming Games" row, so naming both teams isn't enough. False only when the text has the two names
 * with "at" between them in the other order; text without "at" between them can't tell, so it passes.
 */
export function awayAtHome(text: string, away: TeamName, home: TeamName): boolean {
  const tokens = norm(text).split(" ");
  const a = positions(tokens, away.name);
  const h = positions(tokens, home.name);
  const AT = new Set(["at", "ot", "al", "af", "a1", "ai"]); // "at" and how OCR misreads it
  const atBetween = (from: number, to: number) => tokens.slice(from + 1, to).some((t) => AT.has(t));
  const rightWay = a.some((i) => h.some((j) => i < j && atBetween(i, j)));
  const wrongWay = h.some((j) => a.some((i) => j < i && atBetween(j, i)));
  return rightWay || !wrongWay;
}

/**
 * Two OCR reads of the same frame: the same words in the same order, each identical or one misread letter apart
 * ("rn" read as "m" counts as one), with at most a quarter of them jittered. Tells "the key did nothing" from "the
 * screen changed" without being fooled by OCR noise, while two different programs (even the same show on two
 * channels: "WCBS" vs "WNBC" is two letters) still differ.
 */
export function sameText(a: string, b: string): boolean {
  const x = norm(a).split(" ").filter(Boolean);
  const y = norm(b).split(" ").filter(Boolean);
  if (x.length !== y.length) return false;
  let jitter = 0;
  for (let i = 0; i < x.length; i++) {
    if (x[i] === y[i]) continue;
    if (!misreadOf(x[i], y[i])) return false;
    jitter++;
  }
  return jitter <= Math.max(1, Math.floor(x.length / 4));
}

// Characters OCR swaps for each other. A token with digits only "jitters" through these: "CB5" is "CBS", but
// "2" is not "3" and "4.1" is not "5.1" (those are different channels).
const confusable = (s: string) => s.replace(/rn/g, "m").replace(/0/g, "o").replace(/[1il]/g, "l").replace(/5/g, "s").replace(/8/g, "b").replace(/6/g, "g");

/** One token could be an OCR misread of the other. */
function misreadOf(a: string, b: string): boolean {
  if (confusable(a) === confusable(b)) return true;
  if (/\d/.test(a) || /\d/.test(b)) return false;
  return editDistance(a.replace(/rn/g, "m"), b.replace(/rn/g, "m"), 1) <= 1;
}

/** "Are you still watching?" / "Who's watching?" dialogs that can come up over any screen. */
export const POPUP_RE = /are\s+you\s+still\s+watching|still\s+watching\s*\?|who.?s\s+watching/i;
