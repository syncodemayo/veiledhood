import { useCountUp } from "./hooks";

export function Count({ value, format = "int", suffix = "" }: { value: number; format?: "int" | "decimal2"; suffix?: string }) {
  const { ref, display } = useCountUp(value);
  const shown = format === "decimal2" ? (display / 100).toFixed(2) : display.toLocaleString("en-US");
  return (
    <span ref={ref} className="num">
      {shown}
      {suffix}
    </span>
  );
}
