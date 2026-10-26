import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, queryKeys } from '@/lib/api'

export function AddFriendForm(): React.JSX.Element {
  const qc = useQueryClient()
  const [username, setUsername] = useState('')
  const request = useMutation({
    mutationFn: (name: string) => api.friends.request(name),
    onSuccess: () => {
      setUsername('')
      void qc.invalidateQueries({ queryKey: queryKeys.friends })
    }
  })
  const name = username.trim()
  return (
    <div className="space-y-2">
      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name) request.mutate(name)
        }}
      >
        <Input
          aria-label="Discord username"
          placeholder="Discord username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value)
            if (!request.isIdle) request.reset()
          }}
        />
        <Button type="submit" disabled={!name || request.isPending}>
          Send request
        </Button>
      </form>
      {request.isSuccess && (
        <p role="status" className="text-sm text-muted-foreground">
          {request.data.status === 'accepted'
            ? `You're now friends with ${request.data.friend.displayName ?? request.data.friend.username}`
            : 'Request sent'}
        </p>
      )}
      {request.isError && (
        <p role="alert" className="text-sm text-destructive">
          {request.error.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')}
        </p>
      )}
    </div>
  )
}
