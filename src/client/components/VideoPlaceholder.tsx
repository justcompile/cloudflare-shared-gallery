export default function VideoPlaceholder({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-stone-800 to-stone-950 text-stone-400 ${className}`}
      aria-label="Video"
    >
      <span
        aria-hidden
        className="h-0 w-0 translate-x-0.5 border-y-[11px] border-l-[18px] border-y-transparent border-l-amber-400"
      />
      <span className="text-[10px] font-semibold tracking-[0.2em]">VIDEO</span>
    </div>
  );
}
