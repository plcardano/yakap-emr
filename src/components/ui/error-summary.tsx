export type ApiFieldError = {
  /** JSON path from errors[].field. */
  field: string;
  /** Issue code from errors[].issue. */
  issue: string;
  /** Link to the input, when it is on this page. */
  href?: string;
};

type ErrorSummaryProps = {
  title: string;
  body?: string;
  /** Shown so staff can quote it to PhilHealth support. */
  requestId?: string;
  errors?: ApiFieldError[];
};

export function ErrorSummary({ title, body, requestId, errors = [] }: ErrorSummaryProps) {
  return (
    <div role="alert" className="rounded-lg border border-danger bg-danger-soft p-4">
      <h2 className="font-semibold text-danger">{title}</h2>
      {body && <p className="mt-1 text-sm text-ink">{body}</p>}
      {errors.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm">
          {errors.map(({ field, issue, href }) => (
            <li key={`${field}:${issue}`}>
              {href ? (
                <a href={href} className="underline">
                  {field}
                </a>
              ) : (
                field
              )}
              : {issue}
            </li>
          ))}
        </ul>
      )}
      {requestId && <p className="mt-2 text-xs text-muted">Request ID: {requestId}</p>}
    </div>
  );
}
