'use client'

import { useFormState } from 'react-dom'

import { Alert, SubmitButton } from '@/components/ui'
import {
  BUSINESS_DAY_OPTIONS,
  formatBusinessDays,
  formatDuration,
  toTimeInputValue,
} from '@/lib/sla'

import { updateSlaSettingsAction, type SlaSettingsFormState } from './actions'

const initialState: SlaSettingsFormState = { error: null }

export type SlaSettings = {
  firstResponseTargetMinutes: number
  resolutionTargetMinutes: number
  businessHoursStart: string
  businessHoursEnd: string
  businessDays: number[]
  businessTimezone: string
}

/**
 * A short list rather than the full IANA set: a free-text field would let an
 * admin save a name the trigger rejects, and 400+ options in a <select> is not
 * a usable control. "Other" is deliberately absent — the migration default
 * covers the common case and a workspace outside this list is a support
 * request, not a silent failure.
 */
const TIMEZONE_OPTIONS = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC',
]

export function SlaSettingsPanel({
  canManage,
  settings,
}: {
  canManage: boolean
  settings: SlaSettings
}) {
  const [state, formAction] = useFormState(updateSlaSettingsAction, initialState)

  if (!canManage) return <ReadOnlySummary settings={settings} />

  // Uncontrolled inputs with defaultValue: the server action is the source of
  // truth and the page revalidates after a save, so mirroring every field into
  // React state would only add a way for the two to disagree.
  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label="First response target"
          name="firstResponseTargetMinutes"
          defaultValue={settings.firstResponseTargetMinutes}
          hint="Business minutes from the customer's first message to your first reply."
        />
        <NumberField
          label="Resolution target"
          name="resolutionTargetMinutes"
          defaultValue={settings.resolutionTargetMinutes}
          hint="Business minutes to resolve. Snoozed time does not count."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <TimeField
          label="Opening time"
          name="businessHoursStart"
          defaultValue={toTimeInputValue(settings.businessHoursStart)}
        />
        <TimeField
          label="Closing time"
          name="businessHoursEnd"
          defaultValue={toTimeInputValue(settings.businessHoursEnd)}
        />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">Timezone</span>
          <select
            name="businessTimezone"
            defaultValue={settings.businessTimezone}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          >
            {/* A workspace already on a zone outside the list keeps it. */}
            {(TIMEZONE_OPTIONS.includes(settings.businessTimezone)
              ? TIMEZONE_OPTIONS
              : [settings.businessTimezone, ...TIMEZONE_OPTIONS]
            ).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-slate-700">Working days</legend>
        <div className="flex flex-wrap gap-1.5">
          {BUSINESS_DAY_OPTIONS.map((day) => (
            <label
              key={day.value}
              className="cursor-pointer select-none rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition has-[:checked]:border-slate-900 has-[:checked]:bg-slate-900 has-[:checked]:text-white"
            >
              <input
                type="checkbox"
                name="businessDays"
                value={day.value}
                defaultChecked={settings.businessDays.includes(day.value)}
                className="sr-only"
              />
              <span aria-hidden>{day.short}</span>
              <span className="sr-only">{day.long}</span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Overnight hours are not supported: closing time must be after opening time.
        </p>
      </fieldset>

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}

      <SubmitButton pendingLabel="Saving…">Save SLA settings</SubmitButton>
    </form>
  )
}

function ReadOnlySummary({ settings }: { settings: SlaSettings }) {
  return (
    <dl className="space-y-3 text-sm">
      <Row
        label="First response target"
        value={formatDuration(settings.firstResponseTargetMinutes * 60)}
      />
      <Row
        label="Resolution target"
        value={formatDuration(settings.resolutionTargetMinutes * 60)}
      />
      <Row
        label="Business hours"
        value={`${toTimeInputValue(settings.businessHoursStart)}–${toTimeInputValue(
          settings.businessHoursEnd,
        )} ${settings.businessTimezone}`}
      />
      <Row label="Working days" value={formatBusinessDays(settings.businessDays)} />
      <p className="text-xs text-slate-500">Only admins can change these.</p>
    </dl>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{value}</dd>
    </div>
  )
}

function NumberField({
  label,
  name,
  defaultValue,
  hint,
}: {
  label: string
  name: string
  defaultValue: number
  hint: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          name={name}
          defaultValue={defaultValue}
          min={1}
          step={1}
          required
          className="w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
        />
        <span className="text-sm text-slate-500">minutes</span>
      </div>
      <span className="mt-1 block text-xs text-slate-500">{hint}</span>
    </label>
  )
}

function TimeField({
  label,
  name,
  defaultValue,
}: {
  label: string
  name: string
  defaultValue: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      <input
        type="time"
        name={name}
        defaultValue={defaultValue}
        required
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
      />
    </label>
  )
}
