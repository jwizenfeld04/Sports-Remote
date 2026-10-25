import { describe, expect, it } from "vitest";
import { awayAtHome, hasName, hasPhrase, namesTeam, sameText } from "../server/navigation/match";
import { isGamePage } from "../server/youtubeTv";

describe("hasName", () => {
  it("tolerates a misread letter, including rn/m", () => {
    expect(hasName("Chicago Bears at Atlanta Falcans", "Falcons")).toBe(true);
    expect(hasName("Upcoming Garnes", "Games")).toBe(true);
    expect(hasName("Upcorning Games", "Upcoming")).toBe(true);
  });

  it("never lets one team's nickname stand in for another's", () => {
    expect(hasName("Detroit Red Wings at San Jose Sharks", "Kings")).toBe(false);
    expect(hasName("Chicago Bulls at Miami Heat", "Bills")).toBe(false);
    expect(hasName("Milwaukee Bucks", "Ducks")).toBe(false);
    expect(hasName("Toronto Blue Jays", "Blues")).toBe(false);
    expect(hasName("Los Angeles Kings", "Kings")).toBe(true);
  });

  it("phrases are consecutive words", () => {
    expect(hasPhrase("New York Giants at Arizona Cardinals", "New York Giants")).toBe(true);
    expect(hasPhrase("New Orleans at York Giants", "New York Giants")).toBe(false);
  });
});

describe("namesTeam with a shared nickname", () => {
  const nyg = { name: "Giants", city: "New York" };
  const ari = { name: "Cardinals", city: "Arizona" };
  it("rejects another city's team, also when the city is misread", () => {
    expect(namesTeam("San Francisco Giants at St. Louis Cardinals", nyg)).toBe(false);
    expect(namesTeam("Son Franclsco Giants at St. Louis Cardinals", nyg)).toBe(false);
    expect(namesTeam("San Francisco Giants at St. Louis Cardinals", ari)).toBe(false);
    expect(namesTeam("Florida Panthers at Winnipeg Jets", { name: "Jets", city: "New York" })).toBe(false);
    expect(namesTeam("Sacramento Kings at Golden State Warriors", { name: "Kings", city: "Los Angeles" })).toBe(false);
  });
  it("accepts this city's team, a page without cities, and pages naming both", () => {
    expect(namesTeam("New York Giants at Arizona Cardinals", nyg)).toBe(true);
    expect(namesTeam("Giants vs. Cardinals UPCOMING", nyg)).toBe(true);
    expect(namesTeam("New York Giants at San Francisco 49ers", nyg)).toBe(true);
    expect(namesTeam("Chicago Bears at Atlanta Falcons", { name: "Falcons", city: "Atlanta" })).toBe(true);
  });
});

describe("awayAtHome", () => {
  const car = { name: "Panthers" };
  const nyj = { name: "Jets" };
  it("tells the return fixture apart", () => {
    expect(awayAtHome("Carolina Panthers at New York Jets", car, nyj)).toBe(true);
    expect(awayAtHome("New York Jets at Carolina Panthers", car, nyj)).toBe(false);
    expect(awayAtHome("New York Jets ot Carolina Panthers", car, nyj)).toBe(false); // "at" misread
    expect(awayAtHome("Jets vs. Panthers", car, nyj)).toBe(true); // can't tell: pass
  });
  it("is part of the YouTube TV game-page check", () => {
    const g = { away: { name: "Panthers", city: "Carolina" }, home: { name: "Jets", city: "New York" } };
    expect(isGamePage("Oct 18 Carolina Panthers at New York Jets Watch now About", g)).toBe(true);
    expect(isGamePage("Dec 6 New York Jets at Carolina Panthers Watch now About", g)).toBe(false);
  });
});

describe("sameText", () => {
  it("the same frame read twice with OCR jitter", () => {
    expect(sameText("Guide What's On 12:46 AM Jimmy Kimmel Live! 20m left", "Gulde What's On 12:46 AM Jimmy Kimrnel Live! 20rn left")).toBe(true);
    expect(sameText("Guide What's On 12:46 AM Jimmy Kimmel Live! 20m left", "Gulde What'5 On 12:46 AM Jimmy Kimrnel Live! 20rn left")).toBe(false); // 4 of 12 words: too many
    expect(sameText("CBS NFL Football", "CB5 NFL Football")).toBe(true);
  });
  it("different programs, channels or numbers are different", () => {
    expect(sameText("NFL Football Chicago Bears at Atlanta Falcons CBS", "NFL Football Baltimore Ravens at Cleveland Browns FOX")).toBe(false);
    expect(sameText("Local News WCBS", "Local News WNBC")).toBe(false);
    expect(sameText("Program number 2 tonight", "Program number 3 tonight")).toBe(false);
    expect(sameText("4.1 NBC", "5.1 NBC")).toBe(false);
    expect(sameText("a b", "a b c")).toBe(false);
  });
});
