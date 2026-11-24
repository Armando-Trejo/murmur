import mark from "../assets/murmur-mark.png";
export function MurmurMark({
  size = 24,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={mark}
      width={size}
      height={size}
      className={className}
      style={{ objectFit: "contain", flexShrink: 0 }}
      alt=""
      aria-hidden="true"
      decoding="async"
    />
  );
}
