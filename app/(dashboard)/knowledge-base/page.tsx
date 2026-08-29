export const metadata = { title: 'Knowledge Base · SuperDesk' }

export default function KnowledgeBasePage() {
  return (
    <div className="px-10 py-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-xl font-semibold tracking-tight">Knowledge Base</h1>
        <p className="mt-1 text-sm text-slate-500">Help articles, organised into categories.</p>
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
          Nothing here yet. The editor and public help centre are not built.
        </div>
      </div>
    </div>
  )
}
