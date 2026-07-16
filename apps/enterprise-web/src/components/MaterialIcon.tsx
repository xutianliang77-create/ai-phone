export function MaterialIcon({
  name,
  outlined = true,
  label,
}: {
  name: string;
  outlined?: boolean;
  label?: string;
}) {
  return (
    <span
      className={outlined ? "material-icons-outlined" : "material-icons"}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      {name}
    </span>
  );
}
