export function WaitStatus({ label }: { label: string }) {
  if (!label) return null
  return (
    <p className="wait" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  )
}
