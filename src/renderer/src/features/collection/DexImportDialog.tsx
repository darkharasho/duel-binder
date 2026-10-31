import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import type { DexPreview } from '@shared/dex/match'
import { decodeDexFile, parseDexCsv, type DexRow } from '@shared/dex/parse'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { api, invalidateAfterEdit } from '@/lib/api'
import { DEX_MISS_TEXT, notImportedText } from './dexImportText'

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`

async function readFiles(files: File[]): Promise<DexRow[]> {
  const rows: DexRow[] = []
  for (const file of files) {
    try {
      rows.push(...parseDexCsv(decodeDexFile(new Uint8Array(await file.arrayBuffer()))))
    } catch (e) {
      throw new Error(`${file.name}: ${e instanceof Error ? e.message : "couldn't be read"}`, {
        cause: e
      })
    }
  }
  return rows
}

function saveText(text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'dex-not-imported.txt'
  a.click()
  URL.revokeObjectURL(url)
}

function Summary({ preview }: { preview: DexPreview }): React.JSX.Element {
  const missing = preview.notImported
  return (
    <div className="space-y-3 text-sm">
      <p className="font-medium">
        {preview.copies > 0
          ? `${plural(preview.copies, 'card')} to add, across ${plural(preview.printings, 'version')}.`
          : 'Nothing to add.'}
      </p>
      <ul className="space-y-1 text-muted-foreground">
        {preview.alreadyOwned > 0 && (
          <li>{plural(preview.alreadyOwned, 'version')} already at the file&apos;s count.</li>
        )}
        {preview.zeroRows > 0 && <li>{plural(preview.zeroRows, 'line')} skipped: quantity 0.</li>}
        {preview.repeatRows > 0 && (
          <li>
            {plural(preview.repeatRows, 'line')} skipped: the same card in another list or file.
          </li>
        )}
        {missing.length > 0 && (
          <li>{plural(missing.length, 'line')} not imported (listed below).</li>
        )}
      </ul>
      <p className="text-muted-foreground">
        A card in several lists or files counts once, at its highest quantity. Import only raises a
        count up to the file&apos;s, so importing the same file again adds nothing. It never lowers
        a count.
      </p>
      {missing.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium">Not imported</h3>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void api.dex
                    .copy(notImportedText(missing))
                    .then(() => toast.success('Copied the list'))
                }
              >
                Copy
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => saveText(notImportedText(missing))}
              >
                Save
              </Button>
            </div>
          </div>
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-white/[0.08] p-2 text-xs">
            {missing.map((m, i) => (
              <li key={i}>
                {m.name} · {m.set} {m.number} · {m.variant} · {m.locale}
                {m.quantity > 0 && ` × ${m.quantity}`}
                <span className="text-muted-foreground"> · {DEX_MISS_TEXT[m.reason]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Imports Dex CSV exports into the Pokémon collection: pick files, read the preview, import. */
export function DexImportButton(): React.JSX.Element {
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<DexRow[]>([])

  const load = useMutation({
    mutationFn: async (files: File[]): Promise<DexPreview> => {
      const read = await readFiles(files)
      setRows(read)
      return api.dex.preview(read)
    }
  })
  const reset = load.reset
  const run = useMutation({
    mutationFn: () => api.dex.apply(rows),
    onSuccess: ({ copies }) => {
      void invalidateAfterEdit(qc)
      toast.success(`Added ${plural(copies, 'card')} from Dex`)
      setOpen(false)
      reset()
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not import')
  })

  const change = (next: boolean): void => {
    setOpen(next)
    if (!next) reset()
  }
  const preview = load.data

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Upload />
        Import from Dex
      </Button>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import from Dex</DialogTitle>
            <DialogDescription>
              Choose one or more CSV files exported from Dex. Nothing changes until you press
              Import.
            </DialogDescription>
          </DialogHeader>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            multiple
            hidden
            aria-label="Dex CSV files"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              if (files.length > 0) load.mutate(files)
            }}
          />
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={load.isPending}
              onClick={() => input.current?.click()}
            >
              {preview ? 'Choose other files' : 'Choose files'}
            </Button>
          </div>
          {load.isPending && <p className="text-sm text-muted-foreground">Reading…</p>}
          {load.isError && (
            <p role="alert" className="text-sm text-destructive">
              {load.error instanceof Error ? load.error.message : "Couldn't read the file."}
            </p>
          )}
          {preview && <Summary preview={preview} />}
          <DialogFooter>
            <Button
              disabled={!preview || preview.copies === 0 || run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending ? 'Importing…' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
