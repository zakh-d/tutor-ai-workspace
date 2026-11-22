export function VersionBadge() {
  const version = import.meta.env.VITE_APP_VERSION?.trim() || "dev";
  return <span className="badge" aria-label={`Application version ${version}`}>{version}</span>;
}
