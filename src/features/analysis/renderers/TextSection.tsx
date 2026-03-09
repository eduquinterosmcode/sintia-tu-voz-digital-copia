interface TextSectionProps {
  value: unknown;
}

export default function TextSection({ value }: TextSectionProps) {
  if (!value || typeof value !== "string") return null;
  return <p className="text-sm text-muted-foreground leading-relaxed">{value}</p>;
}
