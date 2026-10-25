import json
leagues={'nfl':'teams-nfl.json','nba':'teams-nba.json','mlb':'teams-mlb.json','nhl':'teams-nhl.json'}
# metro id -> (label, timezone, {league:[abbr...]})
M = {
 'atlanta':('Atlanta','America/New_York',{'nfl':['ATL'],'nba':['ATL'],'mlb':['ATL']}),
 'baltimore':('Baltimore','America/New_York',{'nfl':['BAL'],'mlb':['BAL']}),
 'boston':('Boston','America/New_York',{'nfl':['NE'],'nba':['BOS'],'mlb':['BOS'],'nhl':['BOS']}),
 'buffalo':('Buffalo','America/New_York',{'nfl':['BUF'],'nhl':['BUF']}),
 'charlotte':('Charlotte','America/New_York',{'nfl':['CAR'],'nba':['CHA'],'nhl':['CAR']}),
 'raleigh':('Raleigh–Durham','America/New_York',{'nfl':['CAR'],'nhl':['CAR'],'nba':['CHA']}),
 'chicago':('Chicago','America/Chicago',{'nfl':['CHI'],'nba':['CHI'],'mlb':['CHC','CHW'],'nhl':['CHI']}),
 'cincinnati':('Cincinnati','America/New_York',{'nfl':['CIN'],'mlb':['CIN']}),
 'cleveland':('Cleveland','America/New_York',{'nfl':['CLE'],'nba':['CLE'],'mlb':['CLE']}),
 'columbus':('Columbus','America/New_York',{'nhl':['CBJ'],'nfl':['CIN','CLE'],'mlb':['CIN','CLE']}),
 'dallas':('Dallas–Fort Worth','America/Chicago',{'nfl':['DAL'],'nba':['DAL'],'mlb':['TEX'],'nhl':['DAL']}),
 'denver':('Denver','America/Denver',{'nfl':['DEN'],'nba':['DEN'],'mlb':['COL'],'nhl':['COL']}),
 'detroit':('Detroit','America/Detroit',{'nfl':['DET'],'nba':['DET'],'mlb':['DET'],'nhl':['DET']}),
 'green_bay':('Green Bay','America/Chicago',{'nfl':['GB'],'nba':['MIL'],'mlb':['MIL']}),
 'houston':('Houston','America/Chicago',{'nfl':['HOU'],'nba':['HOU'],'mlb':['HOU']}),
 'indianapolis':('Indianapolis','America/Indiana/Indianapolis',{'nfl':['IND'],'nba':['IND']}),
 'jacksonville':('Jacksonville','America/New_York',{'nfl':['JAX']}),
 'kansas_city':('Kansas City','America/Chicago',{'nfl':['KC'],'mlb':['KC']}),
 'las_vegas':('Las Vegas','America/Los_Angeles',{'nfl':['LV'],'nhl':['VGK']}),
 'los_angeles':('Los Angeles','America/Los_Angeles',{'nfl':['LAC','LAR'],'nba':['LAC','LAL'],'mlb':['LAA','LAD'],'nhl':['ANA','LA']}),
 'memphis':('Memphis','America/Chicago',{'nba':['MEM']}),
 'miami':('Miami','America/New_York',{'nfl':['MIA'],'nba':['MIA'],'mlb':['MIA'],'nhl':['FLA']}),
 'milwaukee':('Milwaukee','America/Chicago',{'nfl':['GB'],'nba':['MIL'],'mlb':['MIL']}),
 'minneapolis':('Minneapolis–St. Paul','America/Chicago',{'nfl':['MIN'],'nba':['MIN'],'mlb':['MIN'],'nhl':['MIN']}),
 'nashville':('Nashville','America/Chicago',{'nfl':['TEN'],'nhl':['NSH']}),
 'new_orleans':('New Orleans','America/Chicago',{'nfl':['NO'],'nba':['NO']}),
 'new_york':('New York','America/New_York',{'nfl':['NYG','NYJ'],'nba':['BKN','NY'],'mlb':['NYM','NYY'],'nhl':['NJ','NYI','NYR']}),
 'oklahoma_city':('Oklahoma City','America/Chicago',{'nba':['OKC']}),
 'orlando':('Orlando','America/New_York',{'nba':['ORL'],'nfl':['TB'],'mlb':['TB'],'nhl':['TB']}),
 'philadelphia':('Philadelphia','America/New_York',{'nfl':['PHI'],'nba':['PHI'],'mlb':['PHI'],'nhl':['PHI']}),
 'phoenix':('Phoenix','America/Phoenix',{'nfl':['ARI'],'nba':['PHX'],'mlb':['ARI']}),
 'pittsburgh':('Pittsburgh','America/New_York',{'nfl':['PIT'],'mlb':['PIT'],'nhl':['PIT']}),
 'portland':('Portland','America/Los_Angeles',{'nba':['POR'],'nfl':['SEA'],'mlb':['SEA']}),
 'sacramento':('Sacramento','America/Los_Angeles',{'nba':['SAC'],'mlb':['ATH'],'nfl':['SF'],'nhl':['SJ']}),
 'salt_lake':('Salt Lake City','America/Denver',{'nba':['UTAH'],'nhl':['UTAH']}),
 'san_antonio':('San Antonio','America/Chicago',{'nba':['SA'],'nfl':['DAL','HOU'],'mlb':['HOU','TEX']}),
 'san_diego':('San Diego','America/Los_Angeles',{'mlb':['SD'],'nfl':['LAC']}),
 'sf_bay':('San Francisco Bay Area','America/Los_Angeles',{'nfl':['SF'],'nba':['GS'],'mlb':['SF','ATH'],'nhl':['SJ']}),
 'seattle':('Seattle','America/Los_Angeles',{'nfl':['SEA'],'mlb':['SEA'],'nhl':['SEA']}),
 'st_louis':('St. Louis','America/Chicago',{'mlb':['STL'],'nhl':['STL']}),
 'tampa':('Tampa Bay','America/New_York',{'nfl':['TB'],'mlb':['TB'],'nhl':['TB']}),
 'washington':('Washington, D.C.','America/New_York',{'nfl':['WSH'],'nba':['WSH'],'mlb':['WSH'],'nhl':['WSH']}),
}
NICK = {
 'nfl:LAC':['bolts'],'nfl:NYG':['big blue','g-men','gmen'],'nfl:NYJ':['gang green'],'nfl:SF':['niners'],'nfl:TB':['bucs'],'nfl:WSH':['commies'],'nfl:NE':['pats'],'nfl:GB':['pack'],'nfl:JAX':['jags'],'nfl:PHI':['birds'],
 'mlb:LAD':['blue crew','boys in blue'],'mlb:LAA':['halos'],'mlb:NYM':['amazins','amazin','metropolitans'],'mlb:NYY':['bombers','bronx bombers','yanks'],'mlb:CHW':['sox','white sox','southsiders'],'mlb:BOS':['sox'],'mlb:ATH':["a's",'as','oakland'],'mlb:ARI':['dbacks','d-backs'],'mlb:SF':['san francisco'],
 'nhl:LA':['lak'],'nhl:NYR':['blueshirts'],'nhl:NYI':['isles'],'nhl:TB':['bolts'],'nhl:VGK':['knights'],'nhl:CBJ':['jackets'],'nhl:TOR':['leafs'],'nhl:MTL':['habs'],'nhl:PIT':['pens'],'nhl:WSH':['caps'],'nhl:CAR':['canes'],'nhl:DET':['wings'],'nhl:COL':['avs'],
 'nba:PHI':['sixers'],'nba:POR':['blazers'],'nba:MIN':['wolves','twolves'],'nba:CLE':['cavs'],'nba:DAL':['mavs'],'nba:GS':['dubs','golden state'],'nba:OKC':['okc'],'nba:SA':['spurs'],'nba:NY':['knickerbockers'],'nba:LAL':['lake show'],'nba:BKN':['brooklyn'],'nba:MEM':['grizz'],'nba:NO':['pels'],
}
out=["// Generated from ESPN's team lists (Oct 2026) plus hand-mapped US metro areas. Regenerate with scripts/gen-teams.py.",
"import type { League } from \"../types\";","",
"export interface TeamInfo {","  key: string; // `${league}:${abbr}`","  league: League;","  abbr: string;","  city: string;","  name: string;","  displayName: string;","  color: string;","  alternateColor: string;","  aliases: string[];","}","",
"export const TEAMS: TeamInfo[] = ["]
for l,f in leagues.items():
  d=json.load(open(f))
  for t in sorted((x['team'] for x in d['sports'][0]['leagues'][0]['teams']), key=lambda t:t['displayName']):
    k=f"{l}:{t['abbreviation']}"
    al=sorted(set([t['name'].lower(), t['location'].lower()]+NICK.get(k,[])))
    out.append(f"  {{ key: {json.dumps(k)}, league: {json.dumps(l)}, abbr: {json.dumps(t['abbreviation'])}, city: {json.dumps(t['location'])}, name: {json.dumps(t['name'])}, displayName: {json.dumps(t['displayName'])}, color: \"#{t.get('color','2b3442')}\", alternateColor: \"#{t.get('alternateColor','ffffff')}\", aliases: {json.dumps(al)} }},")
out.append("];")
out.append("")
out.append("export interface Metro {\n  id: string;\n  label: string;\n  timezone: string; // IANA\n  teams: Partial<Record<League, string[]>>; // ESPN abbreviations of the teams whose games count as local here\n}")
out.append("")
out.append("// US metro areas and their local teams. Local = the team's regional broadcasts air here and out-of-market packages")
out.append("// (MLB.TV, NBA League Pass, ESPN's NHL package, Sunday Ticket) black them out. Territories are often wider than the")
out.append("// metro (e.g. much of Iowa is blacked out for six MLB teams), so setup lets people add or remove teams by hand.")
out.append("export const METROS: Metro[] = [")
for k,(lab,tz,teams) in sorted(M.items(), key=lambda kv: kv[1][0]):
  out.append(f"  {{ id: {json.dumps(k)}, label: {json.dumps(lab)}, timezone: {json.dumps(tz)}, teams: {json.dumps(teams)} }},")
out.append("];")
open('teams.ts','w').write("\n".join(out)+"\n")
# validate abbrs
ab={l:{x['team']['abbreviation'] for x in json.load(open(f))['sports'][0]['leagues'][0]['teams']} for l,f in leagues.items()}
for k,(lab,tz,teams) in M.items():
  for l,a in teams.items():
    for x in a:
      assert x in ab[l],(k,l,x)
for k in NICK: 
  l,a=k.split(':'); assert a in ab[l],k
print('ok')
