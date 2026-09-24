
import { useEffect, useState } from "react";

type Status = "open" | "closed" | "locked";

interface Props {
  status: Status;
  animate?: boolean;
}

const colors = {
  open: "#34d399",
  closed: "#fbbf24",
  locked: "#f87171",
};

export default function AnimatedPeriodLock({
  status,
  animate = true,
}: Props) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!animate) return;

    setActive(false);
    const frame = requestAnimationFrame(() => setActive(true));

    return () => cancelAnimationFrame(frame);
  }, [status, animate]);

  const color = colors[status];
  const opened = status === "open";

  return (
    <div
      className={`period-lock period-lock--${status}
        ${active ? "period-lock--active" : ""}`}
      style={{ color }}
      role="img"
      aria-label={`Period ${status}`}
    >
      <svg
        viewBox="0 0 64 64"
        width="64"
        height="64"
        fill="none"
        aria-hidden="true"
      >
        {/* Moving shackle */}
        <g className="period-lock__shackle">
          <path
            d="M19 30V21C19 3 45 3 45 21V30"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </g>

        {/* Fixed lock body */}
        <rect
          x="12"
          y="28"
          width="40"
          height="30"
          rx="7"
          fill="currentColor"
          fillOpacity=".14"
          stroke="currentColor"
          strokeWidth="3"
        />

        <circle cx="32" cy="40" r="3" fill="currentColor" />
        <path
          d="M32 43V48"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />

        {status === "locked" && (
          <path
            className="period-lock__seal"
            d="M43 45L48 50L57 39"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </div>
  );
}