import { useRef, useState } from 'react'
import { DECK_FORMATS, formatOf } from '@shared/decks/formats'
import { MAX_DECK_NAME } from '@shared/decks/fields'
import type { DeckCard, DeckEntry } from '@shared/decks/types'
import { OplayError } from '@shared/decks/onepiece/oplay'
import { parseOpList } from '@shared/decks/onepiece/text'
import { parseMtgText } from '@shared/decks/magic/text'
import { parsePtcgl } from '@shared/decks/pokemon/ptcgl'
import { detectYgoList, parseYgoList } from '@shared/decks/ygo/lists'
import type { GameId } from '@shared/games'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/errorMessage'
import {
  buildPreview,
  deckNameFromFile,
  keptEntries,
  placeOf,
  unresolvedCount,
  type ImportItem,
  type ImportPreview,
  type Pick
} from './deckImport'
import { DeckSearch } from './DeckSearch'
import { FormatSelect } from './FormatSelect'

const MTGO_DEK_MESSAGE = 'Export as text from MTGO instead'

export interface ImportResult {
  name: string
  format: string
  cards: DeckEntry[]
  /** Facts of the cards picked by search, which the deck's own read doesn't have yet. */
  facts: DeckCard[]
}

/**
 * Reads a pasted or picked deck list and shows what it found. Nothing is saved until every line
 * that needs a decision has one; a new deck takes a name and format, an open one asks first.
 */
export function ImportDialog({
  game,
  format: initialFormat,
  replacing,
  busy,
  onApply,
  onClose
}: {
  game: GameId
  format: string
  /** Set when the cards replace an open deck's. */
  replacing?: { name: string; count: number }
  busy: boolean
  onApply: (result: ImportResult) => void
  onClose: () => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [format, setFormat] = useState(initialFormat)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [picks, setPicks] = useState<Record<string, Pick>>({})
  const [searching, setSearching] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const formats = DECK_FORMATS[game]

  const read = async (source: string, intoFormat = format): Promise<void> => {
    setReading(true)
    setError(null)
    setPreview(null)
    setPicks({})
    setSearching(null)
    setConfirming(false)
    try {
      const pkm = game === 'pkm'
      const op = game === 'op'
      const mtg = game === 'mtg'
      // An MTGO .dek is XML; only its text export reads here.
      if (mtg && /^\s*<(\?xml|deck)/i.test(source)) {
        setError(MTGO_DEK_MESSAGE)
        return
      }
      const parsed = mtg
        ? parseMtgText(source)
        : op
          ? parseOpList(source)
          : pkm
            ? parsePtcgl(source)
            : parseYgoList(source)
      const resolutions = parsed.lines.length
        ? await api.decks.resolve(parsed.lines.map((l) => l.ref))
        : []
      if (!parsed.lines.length && !parsed.skipped.length) setError('Nothing to import in that.')
      else
        setPreview(
          buildPreview(
            parsed,
            resolutions,
            pkm || op || mtg ? 'text' : detectYgoList(source),
            game,
            intoFormat
          )
        )
    } catch (e) {
      setError(e instanceof OplayError ? e.message : errorMessage(e, 'Could not read the list'))
    } finally {
      setReading(false)
    }
  }
  const pickFile = async (f: File): Promise<void> => {
    try {
      const body = await f.text()
      setText(body)
      setFileName(f.name)
      await read(body)
    } catch (e) {
      setError(errorMessage(e, 'Could not read that file'))
    }
  }

  const choose = (key: string, p: Pick): void => {
    setPicks((cur) => ({ ...cur, [key]: p }))
    setSearching(null)
  }
  const kept = preview ? keptEntries(preview, picks) : []
  const waiting = preview ? unresolvedCount(preview, picks) : 0
  const label = name.trim() || deckNameFromFile(fileName)
  const ok = !!preview && waiting === 0 && kept.length > 0 && !busy
  const apply = (): void =>
    onApply({
      name: label.slice(0, MAX_DECK_NAME),
      format,
      cards: kept,
      facts: Object.values(picks).flatMap((p) => (!p.drop && p.facts ? [p.facts] : []))
    })

  const undo = (key: string): void =>
    setPicks((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => k !== key)))

  const row = (i: ImportItem, extra: React.ReactNode): React.JSX.Element => (
    <li key={i.key} className="space-y-1.5 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate">{i.text}</span>
        {extra}
      </div>
      {searching === i.key && (
        <DeckSearch
          game={game}
          format={formatOf(game, format) ?? formats[0]}
          commanders={kept.filter((e) => e.section === 'commander').reduce((n, e) => n + e.qty, 0)}
          onAdd={(card, section) =>
            choose(i.key, { card: card.id, section, name: card.name, facts: card })
          }
        />
      )}
    </li>
  )
  const drop = (i: ImportItem): React.JSX.Element => (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Drop ${i.text}`}
      onClick={() => choose(i.key, { drop: true })}
    >
      Drop
    </Button>
  )
  const decided = (i: ImportItem): React.JSX.Element | null => {
    const p = picks[i.key]
    if (!p) return null
    return (
      <li key={i.key} className="flex items-center gap-2 py-1.5 text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{i.text}</span>
        <span>{p.drop ? 'Dropped' : p.name}</span>
        <Button variant="ghost" size="sm" aria-label={`Undo ${i.text}`} onClick={() => undo(i.key)}>
          Undo
        </Button>
      </li>
    )
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{replacing ? 'Replace deck cards' : 'Import a deck'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="deck-list" className="text-sm font-medium">
              Deck list
            </label>
            <textarea
              id="deck-list"
              value={text}
              rows={6}
              placeholder={
                game === 'pkm'
                  ? 'Paste a deck list from Pokémon TCG Live'
                  : game === 'mtg'
                    ? 'Paste an Arena or MTGO deck list'
                    : game === 'op'
                      ? 'Paste a deck list, an OPlay deck code or share link'
                      : 'Paste a deck list, a .ydk, or a ydke:// link'
              }
              onChange={(e) => {
                setText(e.target.value)
                // A preview is of the text it read; an edit after it needs a new one.
                if (preview) {
                  setPreview(null)
                  setPicks({})
                  setSearching(null)
                  setConfirming(false)
                }
              }}
              className="w-full rounded-md border bg-transparent px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={reading || !text.trim()}
                onClick={() => void read(text)}
              >
                Preview
              </Button>
              <Button variant="ghost" size="sm" onClick={() => file.current?.click()}>
                Choose a file
              </Button>
              <input
                ref={file}
                type="file"
                accept={game === 'ygo' ? '.ydk,.txt' : game === 'mtg' ? '.txt,.dek' : '.txt'}
                aria-label="Deck file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void pickFile(f)
                }}
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {reading && <p className="text-sm text-muted-foreground">Reading the list…</p>}
          {preview && (
            <div className="space-y-4 text-sm">
              <section aria-label="Matched" className="space-y-1">
                <h3 className="font-semibold">{`Matched (${preview.matched.length})`}</h3>
                <ul className="max-h-40 divide-y divide-white/[0.06] overflow-y-auto">
                  {preview.matched.map((m) => (
                    <li key={m.key} className="py-1">
                      {m.text}
                    </li>
                  ))}
                </ul>
              </section>
              {preview.ambiguous.length > 0 && (
                <section aria-label="Pick one" className="space-y-1">
                  <h3 className="font-semibold">{`Pick one (${preview.ambiguous.length})`}</h3>
                  <ul className="divide-y divide-white/[0.06]">
                    {preview.ambiguous.map((a) =>
                      picks[a.key]
                        ? decided(a)
                        : row(
                            a,
                            <>
                              <Select
                                value=""
                                onValueChange={(v) => {
                                  const o = a.options.find((x) => x.card === Number(v))
                                  if (o)
                                    choose(a.key, {
                                      card: o.card,
                                      section: placeOf(game, preview.sectioned, a.section, o),
                                      name: o.name
                                    })
                                }}
                              >
                                <SelectTrigger aria-label={`Pick a card for ${a.text}`}>
                                  <SelectValue placeholder="Choose a card" />
                                </SelectTrigger>
                                <SelectContent>
                                  {a.options.map((o) => (
                                    <SelectItem key={o.card} value={String(o.card)}>
                                      {o.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {drop(a)}
                            </>
                          )
                    )}
                  </ul>
                </section>
              )}
              {preview.notFound.length > 0 && (
                <section aria-label="Not found" className="space-y-1">
                  <h3 className="font-semibold">{`Not found (${preview.notFound.length})`}</h3>
                  <ul className="divide-y divide-white/[0.06]">
                    {preview.notFound.map((n) =>
                      picks[n.key]
                        ? decided(n)
                        : row(
                            n,
                            <>
                              {!n.tooMany && !n.leftOut && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  aria-label={`Search for ${n.text}`}
                                  onClick={() => setSearching(searching === n.key ? null : n.key)}
                                >
                                  Search
                                </Button>
                              )}
                              {drop(n)}
                            </>
                          )
                    )}
                  </ul>
                </section>
              )}
              {waiting > 0 && (
                <p className="text-muted-foreground">
                  {`${waiting} ${waiting === 1 ? 'line needs' : 'lines need'} a pick or a drop before you can save.`}
                </p>
              )}
            </div>
          )}
          {preview && !replacing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="import-name" className="text-sm font-medium">
                  Name
                </label>
                <Input
                  id="import-name"
                  value={name}
                  placeholder={deckNameFromFile(fileName)}
                  maxLength={MAX_DECK_NAME}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="import-format" className="text-sm font-medium">
                  Format
                </label>
                <FormatSelect
                  id="import-format"
                  game={game}
                  value={format}
                  onChange={(f) => {
                    setFormat(f)
                    // Whether a Commander deck has a sideboard changes what the list leaves out.
                    if (game === 'mtg' && text.trim()) void read(text, f)
                  }}
                />
              </div>
            </div>
          )}
        </div>
        {confirming && replacing ? (
          <DialogFooter className="items-center">
            <span className="mr-auto text-sm">{`Replace the ${replacing.count} cards in ${replacing.name}?`}</span>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep editing
            </Button>
            <Button variant="destructive" disabled={busy} onClick={apply}>
              Yes, replace
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!ok} onClick={() => (replacing ? setConfirming(true) : apply())}>
              {replacing ? 'Replace cards' : 'Import deck'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
