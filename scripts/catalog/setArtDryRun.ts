/**
 * Dry run of the Pokémon set art match: reads a catalog database's Pokémon sets, asks the
 * Bulbagarden Archives (one request a second, about 20 in all) and the Pokémon TCG API, and prints
 * the coverage and what didn't match. Writes nothing and downloads no images.
 *
 *   npm run catalog:set-art -- <catalog.sqlite>
 *
 * Point it at a copy of catalog-work/work.sqlite or of a desktop collection.db: the database is
 * opened read-only.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { version } from '../../package.json'
import { refreshPokemonSetArt, type SetArtReport } from './pokemon/setArt'

export function formatReport(r: SetArtReport): string[] {
  const lines: string[] = []
  for (const lang of ['en', 'ja'] as const) {
    const p = r.packs[lang]
    lines.push(`${lang} pack art: ${p.matched} of ${p.sets} sets`)
    lines.push(
      `${lang} sets without pack art (${p.unmatchedSets.length}): ${p.unmatchedSets.join('; ')}`
    )
    lines.push(
      `${lang} pack files matching no set (${r.unmatchedFiles[lang].length}): ${r.unmatchedFiles[lang].join('; ')}`
    )
  }
  lines.push(
    `en fallback logos: ${r.logos.matched} of ${r.logos.missing} sets without a TCGdex logo`
  )
  lines.push(
    `en sets with no logo at all (${r.logos.unmatchedSets.length}): ${r.logos.unmatchedSets.join('; ')}`
  )
  for (const p of r.problems) lines.push(`problem: ${p}`)
  return lines
}

async function main(): Promise<void> {
  const file = process.argv[2]
  if (!file) throw new Error('Usage: catalog:set-art -- <catalog.sqlite>')
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const report = await refreshPokemonSetArt(db, { version, dryRun: true })
    for (const line of formatReport(report)) console.log(line)
  } finally {
    db.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e: unknown) => {
    console.error(e)
    process.exit(1)
  })
}
