import { useMemo } from 'react'
import { SUBGRADE_NAMES, parseSubgrades, type GradedCopy } from '@shared/graded'
import { CardArt } from '@/components/CardArt'
import { scanFor } from '@/components/scanFor'
import { cn } from '@/lib/utils'
import {
  agsGold,
  bgsMetal,
  isPristine,
  labelText,
  sgcBadge,
  slabKind,
  type LabelText,
  type SlabKind
} from './slabLook'
import './slabLook.css'

type Slab = Pick<
  GradedCopy,
  'company' | 'grade' | 'label' | 'cert' | 'subgrades' | 'imageId' | 'card' | 'printing' | 'game'
> &
  Parameters<typeof scanFor>[0]

/**
 * A slab drawn after its grader's real case and label: PSA's red frame, Beckett's crest and metal
 * label with subgrades, CGC's black header, SGC's tuxedo, TAG's print on clear plastic, ACE's art
 * label, AGS's gold or navy frame; any other grader gets a plain one. CSS only, in container units, so it scales with its
 * width. `thumb` is for sizes too small to read: the grader's colours and the grade.
 */
export function SlabArt({
  slab,
  size = 'small',
  thumb = false,
  className
}: {
  slab: Slab
  size?: 'small' | 'full'
  thumb?: boolean
  className?: string
}): React.JSX.Element {
  const kind = slabKind(slab.company)
  const t = labelText(kind, slab)
  const art = (
    <CardArt
      imageId={slab.imageId}
      printingId={scanFor(slab)}
      size={size}
      alt=""
      className="w-full"
    />
  )
  const well = <div className="slab-well">{art}</div>
  const metal = kind === 'BGS' ? bgsMetal(slab) : null
  const look = cn(
    'slab',
    `slab-${kind.toLowerCase()}`,
    kind === 'AGS' && !agsGold(slab) && 'slab-navy',
    thumb && 'slab-thumb'
  )

  if (thumb)
    return (
      <div data-testid="slab" data-grader={kind} className={cn('@container', className)}>
        <div className={look}>
          <div className={cn('slab-strip', metal && `slab-${metal}`)}>{t.grade}</div>
          {kind === 'SGC' ? <div className="slab-well">{art}</div> : well}
        </div>
      </div>
    )

  return (
    <div data-testid="slab" data-grader={kind} className={cn('@container', className)}>
      <div className={look}>
        <Label kind={kind} t={t} slab={slab} metal={metal} well={well} />
        {kind === 'SGC' ? null : well}
        {(kind === 'BGS' || kind === 'TAG' || kind === 'AGS') && (
          <div className={cn('slab-emboss', kind === 'AGS' && 'text-right')}>
            {kind === 'BGS' ? 'BECKETT' : kind}
          </div>
        )}
      </div>
    </div>
  )
}

/** The grader's label (and, for SGC, the tuxedo insert round the card). */
function Label({
  kind,
  t,
  slab,
  metal,
  well
}: {
  kind: SlabKind
  t: LabelText
  slab: Slab
  metal: 'black' | 'gold' | 'silver' | null
  well: React.ReactNode
}): React.JSX.Element {
  const line = (text: string, cls?: string): React.JSX.Element | null =>
    text ? <div className={cn('slab-line', cls)}>{text}</div> : null
  switch (kind) {
    case 'PSA':
      return (
        <div className="slab-label">
          <div className="slab-grid">
            {line(`${t.yearGame} ${t.setName}`)}
            <div className="slab-r">{t.number}</div>
            {line(t.name)}
            <div className="slab-r">{t.word}</div>
            {line(t.rarity) ?? <div />}
            <div className="slab-r">{t.grade}</div>
          </div>
          <div className="slab-foot">
            <div className="slab-bar" />
            <span className="slab-mark">PSA</span>
            <span className="slab-mono">{slab.cert}</span>
          </div>
        </div>
      )
    case 'BGS': {
      const subs = parseSubgrades(slab.subgrades)
      return (
        <div className="slab-top">
          <div className="slab-crest" aria-hidden>
            <b>B</b>
            <small>BECKETT</small>
          </div>
          <div className={cn('slab-label', `slab-${metal}`)}>
            <div className="min-w-0">
              {line(`${t.yearGame} ${t.setName}`)}
              {line(`${t.number} ${t.name}`.trim())}
              {subs ? (
                <div className="slab-subs">
                  {SUBGRADE_NAMES.map((n, i) => (
                    <span key={n} className="contents">
                      <span>{n}</span>
                      <b>{subs[i]}</b>
                    </span>
                  ))}
                </div>
              ) : (
                line(t.rarity)
              )}
            </div>
            <div className="slab-overall">
              <div className="slab-n">{t.grade}</div>
              <small>{t.word}</small>
              {slab.cert && <small className="slab-mono">{slab.cert}</small>}
            </div>
          </div>
        </div>
      )
    }
    case 'CGC':
      return (
        <div className="slab-label">
          <div className="slab-head">
            <span className="slab-plate">CGC</span>
            <span className="slab-co">CERTIFIED GUARANTY COMPANY</span>
          </div>
          <div className="slab-body">
            <div className="min-w-0">
              {line(t.name, 'font-bold')}
              {line(`${t.yearGame} ${t.setName}`)}
              {line([t.number.slice(1), t.rarity].filter(Boolean).join(' - '))}
            </div>
            <div className={cn('slab-box', isPristine(slab) && 'slab-gold')}>
              <small>{t.word}</small>
              <div className="slab-n">{t.grade}</div>
            </div>
          </div>
          <div className="slab-foot">
            <div className="slab-bar w-[30%]" />
            <span className="slab-mono">{slab.cert}</span>
          </div>
        </div>
      )
    case 'SGC':
      return (
        <div className="slab-tux">
          <div className="slab-label">
            <div className="slab-mark">SGC</div>
            <div className="slab-info min-w-0">
              {line(`${t.yearGame} ${t.setName}`)}
              {line(`${t.number} ${t.name}`.trim())}
              {line(t.rarity)}
            </div>
            <div className="slab-grade">
              <span className="slab-n">{t.grade}</span>
              <span className="slab-badge">{sgcBadge(t.word)}</span>
            </div>
            {slab.cert && <div className="slab-cert slab-mono">{slab.cert}</div>}
          </div>
          {well}
        </div>
      )
    case 'TAG':
      return (
        <div className="slab-label">
          <span className="slab-mark">TAG</span>
          <div className="slab-info min-w-0">
            {line(t.name)}
            {line(`${t.yearGame} ${t.setName}`)}
            {line([t.number, t.rarity].filter(Boolean).join(' '))}
          </div>
          <div className="slab-qr" aria-hidden>
            <FakeQr seed={slab.cert || slab.card.name} />
          </div>
          <div className="slab-grade">
            {slab.cert && <span className="slab-cert slab-mono">{slab.cert}</span>}
            <div className={cn('slab-g', isPristine(slab) && 'slab-pristine')}>
              <div className="slab-n">{t.grade}</div>
              <small>{t.word}</small>
            </div>
          </div>
        </div>
      )
    case 'ACE':
      return (
        <div className="slab-label">
          <div className="slab-scene">
            <CardArt
              imageId={slab.imageId}
              printingId={scanFor(slab)}
              size="small"
              alt=""
              className="slab-scene-art"
            />
            <div className="slab-info min-w-0">
              {line(`${t.yearGame.split(' ')[0]} ${t.setName}`, 'slab-y')}
              {line(t.name)}
              {line(t.rarity)}
              {line(t.number)}
            </div>
            <div className="slab-g">
              {t.grade}
              <small>{t.word}</small>
            </div>
          </div>
          <div className="slab-foot">
            <div className="slab-bar" />
            <span className="slab-mark">ACE</span>
            <span className="slab-mono">{slab.cert}</span>
          </div>
        </div>
      )
    case 'AGS':
      return (
        <div className="slab-label">
          <div className="slab-grid">
            <div className="min-w-0">
              {line(`${t.yearGame} ${t.setName}`)}
              {line(t.name)}
              {line(t.rarity)}
              {line(t.number)}
            </div>
            <div className="slab-r">
              <div>{t.word}</div>
              <div className="slab-n">{t.grade}</div>
              <div>{slab.cert}</div>
            </div>
          </div>
          <span className="slab-mark">AGS</span>
        </div>
      )
    default:
      return (
        <div className="slab-label">
          <div className="slab-info min-w-0">
            {line(t.name)}
            {line([slab.company, t.word].filter(Boolean).join(' · '))}
            {slab.cert && line(`#${slab.cert}`, 'slab-mono')}
          </div>
          <div className="slab-box">{t.grade}</div>
        </div>
      )
  }
}

/** The modules of FakeQr outside its finder squares, picked from `seed`. */
function qrCells(seed: string): [number, number][] {
  let h = [...seed].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 7)
  const out: [number, number][] = []
  for (let y = 0; y < 21; y++)
    for (let x = 0; x < 21; x++) {
      if ((x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12)) continue
      h = (Math.imul(h, 1103515245) + 12345) >>> 0
      if (h >>> 31) out.push([x, y])
    }
  return out
}

/**
 * A QR-looking pattern for TAG's label: finder squares and modules from the cert, so each slab's
 * differs. It doesn't scan; it's only the look.
 */
function FakeQr({ seed }: { seed: string }): React.JSX.Element {
  const cells = useMemo(() => qrCells(seed), [seed])
  const finder = (x: number, y: number): React.JSX.Element => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width="7" height="7" />
      <rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff" />
      <rect x={x + 2} y={y + 2} width="3" height="3" />
    </g>
  )
  return (
    <svg viewBox="0 0 21 21" shapeRendering="crispEdges">
      {finder(0, 0)}
      {finder(14, 0)}
      {finder(0, 14)}
      {cells.map(([x, y]) => (
        <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" />
      ))}
    </svg>
  )
}
