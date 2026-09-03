import { useMemo, useState } from "react";

type Suit = "♠" | "♥" | "♦" | "♣";
type Card = { rank: string; value: number; suit: Suit };

const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];
const RANKS = [
  ["2", 2], ["3", 3], ["4", 4], ["5", 5], ["6", 6], ["7", 7],
  ["8", 8], ["9", 9], ["10", 10], ["J", 11], ["Q", 12], ["K", 13], ["A", 14],
] as const;

function newDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map(([rank, value]) => ({ rank, value, suit })));
}

function shuffle(cards: Card[]): Card[] {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function handName(hand: Card[]): string {
  if (hand.length !== 5) return "Deal a hand";
  const counts = new Map<number, number>();
  hand.forEach((card) => counts.set(card.value, (counts.get(card.value) || 0) + 1));
  const groups = [...counts.values()].sort((a, b) => b - a);
  const values = [...counts.keys()].sort((a, b) => a - b);
  const straight = values.length === 5 && (
    values[4] - values[0] === 4 ||
    values.join(",") === "2,3,4,5,14"
  );
  const flush = hand.every((card) => card.suit === hand[0]?.suit);
  if (straight && flush) return "Straight flush";
  if (groups[0] === 4) return "Four of a kind";
  if (groups[0] === 3 && groups[1] === 2) return "Full house";
  if (flush) return "Flush";
  if (straight) return "Straight";
  if (groups[0] === 3) return "Three of a kind";
  if (groups[0] === 2 && groups[1] === 2) return "Two pair";
  if (groups[0] === 2) return "One pair";
  return "High card";
}

function CardView({ card, held, onClick }: { card: Card; held: boolean; onClick: () => void }) {
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <button
      className={`flex flex-col items-center justify-center w-14 h-20 border-2 bg-white font-bold ${red ? "text-red-700" : "text-black"} ${held ? "border-yellow-500 -translate-y-1" : "border-black"}`}
      onClick={onClick}
      title={held ? "Held — click to release" : "Click to hold"}
    >
      <span className="text-lg">{card.rank}</span>
      <span className="text-xl leading-none">{card.suit}</span>
      {held && <span className="text-[9px] text-yellow-700">HELD</span>}
    </button>
  );
}

export function Poker() {
  const [hand, setHand] = useState<Card[]>([]);
  const [deck, setDeck] = useState<Card[]>([]);
  const [held, setHeld] = useState<boolean[]>([]);
  const [message, setMessage] = useState("Deal five cards to begin.");
  const [rounds, setRounds] = useState(0);

  const result = useMemo(() => handName(hand), [hand]);

  function deal() {
    const cards = shuffle(newDeck());
    setHand(cards.slice(0, 5));
    setDeck(cards.slice(5));
    setHeld([false, false, false, false, false]);
    setMessage("Hold the cards you want to keep, then draw.");
    setRounds((value) => value + 1);
  }

  function draw() {
    if (hand.length !== 5 || deck.length < 5) return;
    const next = [...hand];
    let deckIndex = 0;
    next.forEach((card, index) => {
      if (!held[index]) next[index] = deck[deckIndex++];
      else next[index] = card;
    });
    setHand(next);
    setDeck(deck.slice(deckIndex));
    setMessage(`Final hand: ${handName(next)}.`);
    setHeld([true, true, true, true, true]);
  }

  return (
    <div className="w-full h-full flex flex-col bg-[#075b37] text-white p-2 gap-3 text-xs">
      <div className="flex items-center gap-2 shrink-0">
        <div className="font-bold tracking-wide">POKER</div>
        <div className="opacity-75">Five-card draw</div>
        <div className="flex-1" />
        <div>Hands: {rounds}</div>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="text-yellow-200 font-bold text-base">{result}</div>
        <div className="flex flex-wrap justify-center gap-2 min-h-[84px]">
          {hand.length === 0
            ? <div className="border border-dashed border-white/50 px-8 py-8 opacity-70">No hand dealt</div>
            : hand.map((card, index) => (
                <CardView
                  key={`${card.rank}${card.suit}`}
                  card={card}
                  held={held[index] || false}
                  onClick={() => {
                    if (held.every(Boolean)) return;
                    setHeld((values) => values.map((value, i) => i === index ? !value : value));
                  }}
                />
              ))}
        </div>
        <div className="text-center opacity-85 min-h-4">{message}</div>
      </div>
      <div className="flex justify-center gap-2 shrink-0">
        <button className="win98-button text-black px-3 py-1" onClick={deal}>Deal</button>
        <button className="win98-button text-black px-3 py-1" disabled={hand.length !== 5 || held.every(Boolean)} onClick={draw}>Draw</button>
      </div>
    </div>
  );
}