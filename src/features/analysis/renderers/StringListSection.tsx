interface StringListSectionProps {
  value: unknown;
}

export default function StringListSection({ value }: StringListSectionProps) {
  if (!Array.isArray(value) || value.length === 0) return null;
  return (
    <ul className="space-y-1">
      {value.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
          <span className="shrink-0 mt-1">•</span>
          <span>{String(item)}</span>
        </li>
      ))}
    </ul>
  );
}
