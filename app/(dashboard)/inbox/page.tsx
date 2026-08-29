export const metadata = { title: 'Inbox · SuperDesk' }

export default function InboxPage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
      <p className="mt-1 text-sm text-slate-500">
        Chat and email conversations will land here.
      </p>
      <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
        Nothing here yet. The chat widget and email channel are not built.
      </div>
    </>
  )
}
