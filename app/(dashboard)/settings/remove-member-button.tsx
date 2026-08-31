'use client'

import { removeTeammateAction } from './actions'

export function RemoveMemberButton({
  profileId,
  displayName,
}: {
  profileId: string
  displayName: string
}) {
  return (
    <form action={removeTeammateAction}>
      <input type="hidden" name="profileId" value={profileId} />
      <button
        type="submit"
        onClick={(event) => {
          if (
            !confirm(
              `Remove ${displayName} from this workspace? They will lose access immediately. Conversations assigned to them become unassigned. You can invite them again later.`,
            )
          ) {
            event.preventDefault()
          }
        }}
        className="text-xs font-medium text-red-600 hover:underline"
      >
        Remove
      </button>
    </form>
  )
}
