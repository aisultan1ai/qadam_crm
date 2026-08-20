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
      className={clsx(animated && "animate-pop", className)}
    >
      <path
        d="M256 90 a150 150 0 1 0 0.1 0 Z M256 130 a110 110 0 1 1 -0.1 0 Z"
        fill="#0d2758"
        fillRule="evenodd"
      />
      <path d="M372 300 L409 399 L330 360 Z" fill="#0d2758" />
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
  height?: number;
};

const ALIGN_CLASS: Record<NonNullable<WordmarkProps["align"]>, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
};

export function Wordmark({ className, align = "center", height = 40 }: WordmarkProps) {
  const width = Math.round((height * 824) / 180);
  return (
    <div className={`flex flex-col ${ALIGN_CLASS[align]} ${className ?? ""}`}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={width}
        height={height}
        viewBox="0 0 824 180"
        role="img"
        aria-label="QADAM"
      >
        <g fill="none" stroke="#0d2758" strokeLinecap="butt" strokeLinejoin="miter" strokeMiterlimit={12}>
          <path d="M 38.5 90.0 a 52.5 52.5 0 1 0 105.0 0 a 52.5 52.5 0 1 0 -105.0 0" strokeWidth="17" />
          <path d="M 127.0 122.5 L 144.9 138.5" strokeWidth="17" />
          <path d="M 204.5 150.0 L 255.0 30.0 L 305.5 150.0" strokeWidth="17" />
          <path
            d="M 366.5 150.0 L 366.5 30.0 L 384.5 30.0 C 471.5 30.0 471.5 150.0 384.5 150.0 Z"
            strokeWidth="17"
          />
          <path d="M 518.5 150.0 L 569.0 30.0 L 619.5 150.0" strokeWidth="17" />
          <path d="M 680.5 150.0 L 680.5 30.0 L 733.0 96.0 L 785.5 30.0 L 785.5 150.0" strokeWidth="17" />
        </g>
      </svg>
    </div>
  );
}
