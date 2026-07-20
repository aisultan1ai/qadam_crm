type LogoMarkProps = {
  size?: number;
  className?: string;
  title?: string;
};

export function LogoMark({ size = 72, className, title = "Qadam CRM" }: LogoMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 72 72"
      role="img"
      aria-label={title}
      className={className}
    >
      <rect width="72" height="72" rx="18" fill="#4f46e5" />
      <path
        d="M36 16a20 20 0 1 0 14.14 34.14"
        fill="none"
        stroke="#ffffff"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path d="M45 45 L58 58" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

type WordmarkProps = {
  className?: string;
  align?: "start" | "center" | "end";
};

const ALIGN_CLASS: Record<NonNullable<WordmarkProps["align"]>, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
};

export function Wordmark({ className, align = "center" }: WordmarkProps) {
  return (
    <div className={`flex flex-col gap-1 ${ALIGN_CLASS[align]} ${className ?? ""}`}>
      <span
        style={{ fontFamily: "Manrope, sans-serif", fontWeight: 800, fontSize: 30, color: "#17171f", lineHeight: 1 }}
      >
        Qadam<span style={{ color: "#4f46e5" }}>.</span>
      </span>
      <span
        style={{
          fontFamily: "Inter, sans-serif",
          fontWeight: 600,
          fontSize: 12,
          color: "#71718a",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          lineHeight: 1,
        }}
      >
        CRM Platform
      </span>
    </div>
  );
}
