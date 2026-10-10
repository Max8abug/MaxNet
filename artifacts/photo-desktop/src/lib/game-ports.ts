export const NEW_GAME_PORTS = [
  {
    id: "amongus",
    title: "Among Us",
    assetId: "among-us",
    repository: "https://github.com/wasmdotrip/AmongUsPort",
  },
  {
    id: "acgamecube",
    title: "Animal Crossing (GameCube)",
    assetId: "ac-gamecube",
    repository: "https://github.com/web-ports/ac-gamecube",
  },
  {
    id: "classof09",
    title: "Class of '09",
    assetId: "class-of-09",
    repository: "https://github.com/genizy/web-port/tree/main/class-of-09",
  },
  {
    id: "cuphead",
    title: "Cuphead",
    assetId: "cuphead",
    repository: "https://github.com/web-ports/cuphead",
  },
  {
    id: "deltatraveler",
    title: "DELTATRAVELER",
    assetId: "deltatraveler",
    repository: "https://github.com/genizy/web-port/tree/main/deltatraveler",
  },
  {
    id: "gangbeasts",
    title: "Gang Beasts",
    assetId: "gang-beasts",
    repository: "https://github.com/jmhq20120212-cmd/GangBeast-WebPort",
  },
  {
    id: "hillclimb",
    title: "Hill Climb Racing",
    assetId: "hill-climb-racing",
    repository: "https://github.com/NotRexed/HillClimbRacingPort",
  },
  {
    id: "untitledgoose",
    title: "Untitled Goose Game",
    assetId: "untitled-goose-game",
    repository: "https://github.com/web-ports/untitled-goose-game",
  },
  {
    id: "oneshot",
    title: "OneShot",
    assetId: "oneshot",
    repository: "https://github.com/Kitaylena/oneshotthing",
  },
] as const;

export type NewGamePortId = (typeof NEW_GAME_PORTS)[number]["id"];
