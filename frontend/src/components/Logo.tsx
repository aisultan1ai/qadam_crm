import clsx from "clsx";

type LogoMarkProps = {
  size?: number;
  className?: string;
  title?: string;
  animated?: boolean;
};

export function LogoMark({ size = 72, className, title = "Qadam CRM", animated = false }: LogoMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label={title}
      className={clsx(
        "text-[#0d2758] dark:text-white",
        animated && "animate-pop",
        className,
      )}
    >
      <path
        d="M256 90 a150 150 0 1 0 0.1 0 Z M256 130 a110 110 0 1 1 -0.1 0 Z"
        fill="currentColor"
        fillRule="evenodd"
      />
      <path d="M372 300 L409 399 L330 360 Z" fill="currentColor" />
      <rect x="274" y="176" width="80" height="60" rx="12" fill="#a2cafd" />
      <rect x="224" y="228" width="80" height="60" rx="12" fill="#5fa0fe" />
      <g fill="#0f67fd">
        <rect x="184" y="278" width="70" height="50" rx="12" />
        <path d="M249 296 L318 340 L199 328 Z" />
      </g>
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
        className="text-[#0d2758] dark:text-white"
        style={{
          fontFamily: "Manrope, Inter, sans-serif",
          fontWeight: 800,
          fontSize: 30,
          lineHeight: 1,
        }}
      >
        Qadam<span style={{ color: "#0f67fd" }}>.</span>
      </span>
      <span
        className="text-neutral-500 dark:text-neutral-400"
        style={{
          fontFamily: "Inter, sans-serif",
          fontWeight: 600,
          fontSize: 11,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          lineHeight: 1,
        }}
      >
        CRM Platform
      </span>
    </div>
  );
}
